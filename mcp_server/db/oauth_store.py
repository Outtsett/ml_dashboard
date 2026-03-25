"""In-memory OAuth store for Claude.ai MCP integration.

Implements the full OAuth 2.0 authorization server flow that Claude.ai
requires for remote MCP servers. All state is in-memory (resets on restart).
Auto-approves all authorization requests since the server is local/tunneled.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from mcp.server.auth.provider import (
    AuthorizationCode,
    AuthorizationParams,
    OAuthClientInformationFull,
    OAuthToken,
    RefreshToken,
)

from fastmcp.server.auth.auth import AccessToken, OAuthProvider


@dataclass
class StoredAuthCode:
    code: str
    client_id: str
    redirect_uri: str
    code_challenge: str
    scopes: list[str]
    created_at: float = field(default_factory=time.time)
    expires_in: int = 300  # 5 minutes


@dataclass
class StoredToken:
    token: str
    client_id: str
    scopes: list[str]
    created_at: float = field(default_factory=time.time)
    expires_in: int = 3600  # 1 hour


class AutoApproveOAuthProvider(OAuthProvider):
    """OAuth provider that auto-approves all requests.

    Stores clients, auth codes, and tokens in memory. Designed for
    local/tunneled MCP servers where the only client is Claude.ai.
    """

    def __init__(self, base_url: str, **kwargs: Any):
        from mcp.server.auth.settings import ClientRegistrationOptions

        super().__init__(
            base_url=base_url,
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                valid_scopes=["read"],
            ),
            **kwargs,
        )
        self._clients: dict[str, OAuthClientInformationFull] = {}
        self._auth_codes: dict[str, StoredAuthCode] = {}
        self._tokens: dict[str, StoredToken] = {}
        self._refresh_tokens: dict[str, StoredToken] = {}

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return self._clients.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        self._clients[client_info.client_id] = client_info

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Auto-approve and redirect back with an auth code."""
        code = secrets.token_urlsafe(32)
        self._auth_codes[code] = StoredAuthCode(
            code=code,
            client_id=client.client_id,
            redirect_uri=str(params.redirect_uri),
            code_challenge=params.code_challenge or "",
            scopes=params.scopes or [],
        )
        # Redirect back to client with the authorization code
        redirect = str(params.redirect_uri)
        separator = "&" if "?" in redirect else "?"
        return f"{redirect}{separator}code={code}&state={params.state or ''}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        stored = self._auth_codes.get(authorization_code)
        if not stored:
            return None
        if stored.client_id != client.client_id:
            return None
        if time.time() - stored.created_at > stored.expires_in:
            del self._auth_codes[authorization_code]
            return None
        return AuthorizationCode(
            code=stored.code,
            client_id=stored.client_id,
            redirect_uri=stored.redirect_uri,
            code_challenge=stored.code_challenge,
            scopes=stored.scopes,
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        # Remove used auth code
        self._auth_codes.pop(authorization_code.code, None)

        # Generate tokens
        access_token = secrets.token_urlsafe(32)
        refresh_token = secrets.token_urlsafe(32)

        self._tokens[access_token] = StoredToken(
            token=access_token,
            client_id=client.client_id,
            scopes=authorization_code.scopes or [],
        )
        self._refresh_tokens[refresh_token] = StoredToken(
            token=refresh_token,
            client_id=client.client_id,
            scopes=authorization_code.scopes or [],
        )

        return OAuthToken(
            access_token=access_token,
            token_type="bearer",
            expires_in=3600,
            refresh_token=refresh_token,
            scope=" ".join(authorization_code.scopes or []),
        )

    async def load_access_token(self, token: str) -> AccessToken | None:
        stored = self._tokens.get(token)
        if not stored:
            return None
        if time.time() - stored.created_at > stored.expires_in:
            del self._tokens[token]
            return None
        return AccessToken(
            token=token,
            client_id=stored.client_id,
            scopes=stored.scopes,
            expires_at=int(stored.created_at + stored.expires_in),
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        stored = self._refresh_tokens.get(refresh_token)
        if not stored:
            return None
        if stored.client_id != client.client_id:
            return None
        return RefreshToken(
            token=stored.token,
            client_id=stored.client_id,
            scopes=stored.scopes,
        )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str] | None = None,
    ) -> OAuthToken:
        # Revoke old refresh token
        self._refresh_tokens.pop(refresh_token.token, None)

        # Generate new tokens
        new_access = secrets.token_urlsafe(32)
        new_refresh = secrets.token_urlsafe(32)
        token_scopes = scopes or refresh_token.scopes or []

        self._tokens[new_access] = StoredToken(
            token=new_access,
            client_id=client.client_id,
            scopes=token_scopes,
        )
        self._refresh_tokens[new_refresh] = StoredToken(
            token=new_refresh,
            client_id=client.client_id,
            scopes=token_scopes,
        )

        return OAuthToken(
            access_token=new_access,
            token_type="bearer",
            expires_in=3600,
            refresh_token=new_refresh,
            scope=" ".join(token_scopes),
        )

    async def revoke_token(
        self, token: str, token_type_hint: str | None = None
    ) -> None:
        self._tokens.pop(token, None)
        self._refresh_tokens.pop(token, None)
