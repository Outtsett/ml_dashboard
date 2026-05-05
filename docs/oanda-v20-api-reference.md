# OANDA v20 REST API -- Complete Reference

## Table of Contents

1. [Base URLs](#base-urls)
2. [Authentication](#authentication)
3. [Request/Response Conventions](#requestresponse-conventions)
4. [Rate Limits](#rate-limits)
5. [Account Endpoints](#account-endpoints)
6. [Instrument Endpoints](#instrument-endpoints)
7. [Pricing Endpoints](#pricing-endpoints)
8. [Order Endpoints](#order-endpoints)
9. [Trade Endpoints](#trade-endpoints)
10. [Position Endpoints](#position-endpoints)
11. [Transaction Endpoints](#transaction-endpoints)
12. [Streaming Endpoints](#streaming-endpoints)
13. [Enums and Type Reference](#enums-and-type-reference)
14. [Error Handling](#error-handling)

---

## Base URLs

| Environment | REST API                              | Streaming API                            |
|-------------|---------------------------------------|------------------------------------------|
| Practice    | `https://api-fxpractice.oanda.com`    | `https://stream-fxpractice.oanda.com`    |
| Live        | `https://api-fxtrade.oanda.com`       | `https://stream-fxtrade.oanda.com`       |

All REST endpoints are prefixed with `/v3/`. Streaming endpoints use the streaming base URLs with `/v3/` prefix.

---

## Authentication

### Token Generation

Generate a personal access token at: **My Account -> My Services -> Manage API Access** in the fxTrade account portal. The token grants access to all sub-accounts.

### Token Format

Alphanumeric string with hyphens: `12345678900987654321-abc34135acde13f13530`

### Authorization Header

Every request requires the `Authorization` header with a Bearer token:

```
Authorization: Bearer 12345678900987654321-abc34135acde13f13530
```

### Example curl

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "https://api-fxpractice.oanda.com/v3/accounts"
```

### Security Notes

- Treat tokens like passwords -- OANDA does not retain copies
- If compromised, revoke the current token and generate a new one
- Legacy REST API tokens are compatible with v20 API
- OANDA can suspend tokens for system stability

---

## Request/Response Conventions

### Required Headers (All Requests)

| Header                    | Value                  | Required | Notes                                       |
|---------------------------|------------------------|----------|---------------------------------------------|
| `Authorization`           | `Bearer <TOKEN>`       | Yes      | Every request                               |
| `Content-Type`            | `application/json`     | Yes*     | Required for POST/PUT/PATCH with body        |
| `Accept-Datetime-Format`  | `RFC3339` or `UNIX`    | No       | Default: `RFC3339`                          |

### DateTime Formats

| Format  | Example                              | Description                              |
|---------|--------------------------------------|------------------------------------------|
| RFC3339 | `2017-12-21T01:22:37.762530000Z`     | ISO 8601 with nanosecond precision       |
| UNIX    | `1513819357.762530000`               | Seconds since epoch, up to 9 decimals    |

### Numeric Values

All decimal numbers (prices, units, P&L) are represented as **strings**, not JSON numbers. This preserves precision.

```json
{
  "price": "1.13033",
  "units": "10000",
  "pl": "-0.01438"
}
```

### Instrument Name Format

Base and quote currencies separated by underscore: `EUR_USD`, `USD_JPY`, `GBP_CHF`

### Instrument Types

- `CURRENCY` -- Forex pairs
- `CFD` -- Contracts for Difference
- `METAL` -- Precious metals (XAU_USD, XAG_USD)

### Pagination

Responses with truncated results include a `Link` header with a pagination cursor. Use the `beforeID` query parameter for paginated list requests.

### Transaction ID Tracking

Most responses include `lastTransactionID` -- a monotonically increasing ID representing the latest transaction on the account. Use this for change polling.

---

## Rate Limits

| Resource         | Limit                        | Scope          |
|------------------|------------------------------|----------------|
| REST requests    | 120 requests/second          | Per IP address |
| Streaming        | 20 active streams            | Per IP address |
| New connections  | 2 connections/second         | Per IP address |

- Exceeding REST limit returns HTTP 429
- Exceeding streaming limit rejects the connection
- Use persistent connections for best performance

---

## Account Endpoints

### GET /v3/accounts

List all accounts authorized for the token.

**Headers:** `Authorization` (required)

**Response 200:**

```json
{
  "accounts": [
    {
      "id": "101-004-12345678-001",
      "tags": []
    }
  ]
}
```

---

### GET /v3/accounts/{accountID}

Full account details including open orders, trades, and positions.

**Headers:** `Authorization` (required), `Accept-Datetime-Format` (optional)

**Response 200:**

```json
{
  "account": {
    "id": "101-004-12345678-001",
    "alias": "My Account",
    "currency": "USD",
    "balance": "43650.78835",
    "NAV": "43650.78835",
    "marginAvailable": "43650.78835",
    "marginUsed": "0.00000",
    "marginRate": "0.02",
    "openPositionCount": 0,
    "openTradeCount": 0,
    "pendingOrderCount": 0,
    "pl": "-1299.21165",
    "unrealizedPL": "0.00000",
    "hedgingEnabled": false,
    "createdTime": "2016-06-22T18:41:48.000000000Z",
    "createdByUserID": 12345678,
    "orders": [],
    "trades": [],
    "positions": [
      {
        "instrument": "EUR_USD",
        "pl": "-54.23000",
        "long": {
          "units": "0",
          "pl": "-54.23000",
          "unrealizedPL": "0.00000"
        },
        "short": {
          "units": "0",
          "pl": "0.00000",
          "unrealizedPL": "0.00000"
        }
      }
    ]
  },
  "lastTransactionID": "6397"
}
```

---

### GET /v3/accounts/{accountID}/summary

Streamlined account summary without embedded orders/trades/positions arrays.

**Headers:** `Authorization` (required), `Accept-Datetime-Format` (optional)

**Response 200:**

```json
{
  "account": {
    "id": "101-004-12345678-001",
    "alias": "My Account",
    "currency": "USD",
    "balance": "43650.78835",
    "NAV": "43650.78835",
    "marginAvailable": "43650.78835",
    "marginUsed": "0.00000",
    "openPositionCount": 0,
    "openTradeCount": 0,
    "pendingOrderCount": 0,
    "pl": "-1299.21165",
    "unrealizedPL": "0.00000"
  },
  "lastTransactionID": "6397"
}
```

---

### GET /v3/accounts/{accountID}/instruments

List tradeable instruments for the account.

**Headers:** `Authorization` (required)

**Query Parameters:**

| Param        | Type   | Description                           |
|--------------|--------|---------------------------------------|
| `instruments`| string | CSV list of instrument names to filter |

**Response 200:**

```json
{
  "instruments": [
    {
      "name": "EUR_USD",
      "type": "CURRENCY",
      "displayName": "EUR/USD",
      "pipLocation": -4,
      "displayPrecision": 5,
      "tradeUnitsPrecision": 0,
      "minimumTradeSize": "1",
      "maximumPositionSize": "0",
      "maximumOrderUnits": "100000000",
      "marginRate": "0.02",
      "minimumTrailingStopDistance": "0.00050",
      "maximumTrailingStopDistance": "1.00000"
    }
  ],
  "lastTransactionID": "6397"
}
```

**Key fields:**

- `pipLocation`: Exponent for pip value. `-4` means 1 pip = 0.0001 (4th decimal)
- `displayPrecision`: Number of decimal places for display
- `marginRate`: `"0.02"` = 2% margin = 50:1 leverage
- `minimumTradeSize`: Smallest allowed order in units

---

### PATCH /v3/accounts/{accountID}/configuration

Modify account alias or margin rate.

**Headers:** `Authorization` (required), `Content-Type: application/json`

**Request Body:**

```json
{
  "alias": "My Trading Account",
  "marginRate": "0.05"
}
```

Both fields are optional. `marginRate` of `"0.05"` = 5% margin = 20:1 leverage.

**Response 200:**

```json
{
  "clientConfigureTransaction": {
    "id": "6398",
    "accountID": "101-004-12345678-001",
    "userID": 12345678,
    "type": "CLIENT_CONFIGURE",
    "time": "2016-06-22T18:41:48.000000000Z",
    "alias": "My Trading Account",
    "marginRate": "0.05"
  },
  "lastTransactionID": "6398"
}
```

---

### GET /v3/accounts/{accountID}/changes

Poll for account changes since a given transaction ID. Use `lastTransactionID` from previous responses to poll efficiently.

**Query Parameters:**

| Param                | Type          | Description                           |
|----------------------|---------------|---------------------------------------|
| `sinceTransactionID` | TransactionID | Return changes after this transaction |

**Response 200:**

```json
{
  "changes": {
    "ordersCreated": [],
    "ordersFilled": [],
    "ordersCancelled": [],
    "ordersTriggered": [],
    "tradesOpened": [],
    "tradesClosed": [],
    "tradesReduced": [],
    "positions": [],
    "transactions": []
  },
  "state": {
    "NAV": "43650.78835",
    "marginAvailable": "43650.78835",
    "marginUsed": "0.00000",
    "unrealizedPL": "0.00000",
    "positionValue": "0.00000",
    "positions": [],
    "trades": []
  },
  "lastTransactionID": "6397"
}
```

---

## Instrument Endpoints

### GET /v3/instruments/{instrument}/candles

Fetch candlestick/OHLC data for an instrument.

**Path Parameters:** `instrument` (required) -- e.g., `EUR_USD`

**Query Parameters:**

| Param              | Type     | Default             | Description                                              |
|--------------------|----------|---------------------|----------------------------------------------------------|
| `price`            | string   | `"M"`               | `M` (mid), `B` (bid), `A` (ask), `BA`, `MBA`, etc.      |
| `granularity`      | string   | `"S5"`              | Candle timeframe (see Granularity enum below)            |
| `count`            | integer  | `500`               | Number of candles (max 5000)                             |
| `from`             | DateTime | --                  | Start time (inclusive by default)                        |
| `to`               | DateTime | --                  | End time (exclusive)                                     |
| `smooth`           | boolean  | `false`             | If true, use previous close as current open              |
| `includeFirst`     | boolean  | `true`              | Include the candle at `from` time                        |
| `dailyAlignment`   | integer  | `17`                | Hour of day for daily candle alignment (0-23)            |
| `alignmentTimezone`| string   | `America/New_York`  | Timezone for daily alignment                             |
| `weeklyAlignment`  | string   | `Friday`            | Day of week for weekly candle alignment                  |

**Important:** You can specify `count` OR `from`/`to`, but not both `count` and `to` together. If both `from` and `to` are specified, `count` is ignored and up to 5000 candles between the two times are returned.

**Response 200:**

```json
{
  "instrument": "EUR_USD",
  "granularity": "H1",
  "candles": [
    {
      "time": "2016-10-17T15:00:00.000000000Z",
      "mid": {
        "o": "1.09949",
        "h": "1.09972",
        "l": "1.09911",
        "c": "1.09946"
      },
      "bid": {
        "o": "1.09936",
        "h": "1.09959",
        "l": "1.09898",
        "c": "1.09933"
      },
      "ask": {
        "o": "1.09962",
        "h": "1.09985",
        "l": "1.09924",
        "c": "1.09959"
      },
      "volume": 2547,
      "complete": true
    }
  ]
}
```

**Notes:**

- `bid`/`ask`/`mid` objects only appear if requested via the `price` parameter
- `complete: false` means the candle is still forming (current/latest candle)
- `o`/`h`/`l`/`c` = open/high/low/close
- `volume` = number of price ticks during the candle, not lot volume
- Historical data available back to approximately 2005

---

### GET /v3/instruments/{instrument}/orderBook

**NOTE: OANDA discontinued this endpoint as a business decision. It may not be functional.**

Fetch the order book for an instrument.

**Query Parameters:** `time` (optional DateTime)

---

### GET /v3/instruments/{instrument}/positionBook

**NOTE: OANDA discontinued this endpoint as a business decision. It may not be functional.**

Fetch the position book for an instrument.

**Query Parameters:** `time` (optional DateTime)

---

## Pricing Endpoints

### GET /v3/accounts/{accountID}/pricing

Get current prices for one or more instruments.

**Query Parameters:**

| Param        | Type   | Description                                       |
|--------------|--------|---------------------------------------------------|
| `instruments`| string | **Required.** CSV list: `EUR_USD,USD_JPY,GBP_USD` |

**Response 200:**

```json
{
  "prices": [
    {
      "type": "PRICE",
      "instrument": "EUR_USD",
      "time": "2016-06-22T18:41:48.000000000Z",
      "tradeable": true,
      "bids": [
        { "price": "1.13028", "liquidity": 10000000 }
      ],
      "asks": [
        { "price": "1.13038", "liquidity": 10000000 }
      ],
      "closeoutBid": "1.13028",
      "closeoutAsk": "1.13038"
    }
  ],
  "time": "2016-06-22T18:41:48.000000000Z"
}
```

**Key fields:**

- `bids`/`asks`: Arrays of `PriceBucket` objects with `price` and `liquidity` (available units at that price). Multiple buckets represent depth of book.
- `closeoutBid`/`closeoutAsk`: Prices used when closing a position with no regular bid/ask liquidity
- `tradeable`: `false` when market is closed (weekends, holidays)
- Spread = `asks[0].price` - `bids[0].price`

---

### GET /v3/accounts/{accountID}/pricing/stream

**STREAMING ENDPOINT -- use streaming base URL.**

Real-time price stream via chunked transfer encoding.

**Query Parameters:**

| Param        | Type   | Description                                         |
|--------------|--------|-----------------------------------------------------|
| `instruments`| string | **Required.** CSV list: `EUR_USD,USD_JPY`           |
| `snapshot`   | boolean| If true, send a snapshot of current prices first    |

**Example curl:**

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "https://stream-fxpractice.oanda.com/v3/accounts/<ACCOUNT>/pricing/stream?instruments=EUR_USD,USD_CAD"
```

**Response:** Chunked JSON, one object per line. Two object types:

**Price object:**

```json
{
  "type": "PRICE",
  "instrument": "EUR_USD",
  "time": "2016-06-22T18:41:48.000000000Z",
  "tradeable": true,
  "bids": [
    { "price": "1.13028", "liquidity": 10000000 }
  ],
  "asks": [
    { "price": "1.13038", "liquidity": 10000000 }
  ],
  "closeoutBid": "1.13028",
  "closeoutAsk": "1.13038"
}
```

**Heartbeat object (every 5 seconds):**

```json
{
  "type": "HEARTBEAT",
  "time": "2016-06-22T18:41:53.000000000Z"
}
```

**Streaming Notes:**

- Max ~4 price updates per second per instrument
- Heartbeats sent every 5 seconds to keep the connection alive
- Each JSON object is serialized on a single line
- Multiple objects in the same chunk are separated by newlines
- Response header: `Transfer-Encoding: chunked`, `Content-Type: application/json`
- Max 20 active streaming connections per IP

---

### GET /v3/accounts/{accountID}/candles/latest

Get the most recent complete candle for specified instrument/granularity pairs.

**Query Parameters:**

| Param                  | Type   | Description                                                  |
|------------------------|--------|--------------------------------------------------------------|
| `candleSpecifications` | string | **Required.** CSV list in format `INSTRUMENT:GRANULARITY:PRICE` |
| `smooth`               | boolean| Default false                                                |
| `units`                | integer| For home conversion calculations                             |

**Example:** `?candleSpecifications=EUR_USD:H1:MBA,USD_JPY:M5:M`

**Response 200:**

```json
{
  "latestCandles": [
    {
      "instrument": "EUR_USD",
      "granularity": "H1",
      "candles": [
        {
          "time": "2016-10-17T15:00:00.000000000Z",
          "mid": { "o": "1.09949", "h": "1.09972", "l": "1.09911", "c": "1.09946" },
          "bid": { "o": "1.09936", "h": "1.09959", "l": "1.09898", "c": "1.09933" },
          "ask": { "o": "1.09962", "h": "1.09985", "l": "1.09924", "c": "1.09959" },
          "volume": 2547,
          "complete": true
        }
      ]
    }
  ]
}
```

---

## Order Endpoints

### POST /v3/accounts/{accountID}/orders

Create a new order.

**Headers:** `Authorization` (required), `Content-Type: application/json`

---

#### Market Order

Filled immediately at current market price.

```json
{
  "order": {
    "type": "MARKET",
    "instrument": "EUR_USD",
    "units": "10000",
    "timeInForce": "FOK",
    "positionFill": "DEFAULT"
  }
}
```

**With SL/TP attached:**

```json
{
  "order": {
    "type": "MARKET",
    "instrument": "EUR_USD",
    "units": "10000",
    "timeInForce": "FOK",
    "positionFill": "DEFAULT",
    "takeProfitOnFill": {
      "price": "1.14000",
      "timeInForce": "GTC"
    },
    "stopLossOnFill": {
      "price": "1.12000",
      "timeInForce": "GTC"
    },
    "trailingStopLossOnFill": {
      "distance": "0.00100",
      "timeInForce": "GTC"
    },
    "clientExtensions": {
      "id": "my_order_1",
      "tag": "strategy_alpha",
      "comment": "Long EUR/USD trend entry"
    },
    "tradeClientExtensions": {
      "id": "my_trade_1",
      "tag": "strategy_alpha",
      "comment": "Long EUR/USD trend entry"
    }
  }
}
```

**Units:** Positive = BUY/LONG, Negative = SELL/SHORT

- `"units": "10000"` -- buy 10,000 units
- `"units": "-10000"` -- sell 10,000 units

**priceBound:** Optional. Worst price for slippage protection on market orders.

---

#### Limit Order

Execute at specified price or better. Use for entries below current ask (buy) or above current bid (sell).

```json
{
  "order": {
    "type": "LIMIT",
    "instrument": "EUR_USD",
    "units": "10000",
    "price": "1.12500",
    "timeInForce": "GTC",
    "positionFill": "DEFAULT",
    "triggerCondition": "DEFAULT",
    "takeProfitOnFill": {
      "price": "1.14000",
      "timeInForce": "GTC"
    },
    "stopLossOnFill": {
      "price": "1.11500",
      "timeInForce": "GTC"
    }
  }
}
```

For GTD (Good Till Date), include `gtdTime`:

```json
{
  "order": {
    "type": "LIMIT",
    "instrument": "EUR_USD",
    "units": "10000",
    "price": "1.12500",
    "timeInForce": "GTD",
    "gtdTime": "2026-04-01T00:00:00.000000000Z",
    "positionFill": "DEFAULT",
    "triggerCondition": "DEFAULT"
  }
}
```

---

#### Stop Order

Execute when price reaches trigger level (buy above current ask, sell below current bid -- breakout entries).

```json
{
  "order": {
    "type": "STOP",
    "instrument": "EUR_USD",
    "units": "10000",
    "price": "1.14000",
    "priceBound": "1.14050",
    "timeInForce": "GTC",
    "positionFill": "DEFAULT",
    "triggerCondition": "DEFAULT",
    "takeProfitOnFill": {
      "price": "1.15000",
      "timeInForce": "GTC"
    },
    "stopLossOnFill": {
      "price": "1.13500",
      "timeInForce": "GTC"
    }
  }
}
```

`priceBound` acts as a limit after the stop triggers -- optional slippage protection.

---

#### Market If Touched Order

Becomes a market order when price reaches trigger (like a limit order but guarantees fill, not price).

```json
{
  "order": {
    "type": "MARKET_IF_TOUCHED",
    "instrument": "EUR_USD",
    "units": "10000",
    "price": "1.12500",
    "priceBound": "1.12450",
    "timeInForce": "GTC",
    "positionFill": "DEFAULT",
    "triggerCondition": "DEFAULT"
  }
}
```

---

#### Take Profit Order (on existing trade)

```json
{
  "order": {
    "type": "TAKE_PROFIT",
    "tradeID": "6395",
    "price": "1.14000",
    "timeInForce": "GTC",
    "triggerCondition": "DEFAULT"
  }
}
```

---

#### Stop Loss Order (on existing trade)

By price:

```json
{
  "order": {
    "type": "STOP_LOSS",
    "tradeID": "6395",
    "price": "1.12000",
    "timeInForce": "GTC",
    "triggerCondition": "DEFAULT"
  }
}
```

By distance from current price:

```json
{
  "order": {
    "type": "STOP_LOSS",
    "tradeID": "6395",
    "distance": "0.00100",
    "timeInForce": "GTC",
    "triggerCondition": "DEFAULT"
  }
}
```

Only specify `price` OR `distance`, not both.

---

#### Guaranteed Stop Loss Order (on existing trade)

Same as stop loss but guarantees execution at the exact price (premium charged).

```json
{
  "order": {
    "type": "GUARANTEED_STOP_LOSS",
    "tradeID": "6395",
    "price": "1.12000",
    "timeInForce": "GTC",
    "triggerCondition": "DEFAULT"
  }
}
```

---

#### Trailing Stop Loss Order (on existing trade)

```json
{
  "order": {
    "type": "TRAILING_STOP_LOSS",
    "tradeID": "6395",
    "distance": "0.00100",
    "timeInForce": "GTC",
    "triggerCondition": "DEFAULT"
  }
}
```

`distance` is in price units (e.g., `"0.00100"` = 10 pips for EUR_USD).

---

### Order Creation Response (HTTP 201)

```json
{
  "orderCreateTransaction": {
    "id": "6367",
    "accountID": "101-004-12345678-001",
    "userID": 12345678,
    "batchID": "6367",
    "type": "MARKET_ORDER",
    "instrument": "EUR_USD",
    "units": "10000",
    "timeInForce": "FOK",
    "positionFill": "DEFAULT",
    "reason": "CLIENT_ORDER",
    "time": "2016-06-22T18:41:48.000000000Z"
  },
  "orderFillTransaction": {
    "id": "6368",
    "accountID": "101-004-12345678-001",
    "userID": 12345678,
    "batchID": "6367",
    "type": "ORDER_FILL",
    "orderID": "6367",
    "instrument": "EUR_USD",
    "units": "10000",
    "price": "1.13033",
    "pl": "0.00000",
    "financing": "0.00000",
    "accountBalance": "43650.78835",
    "reason": "MARKET_ORDER",
    "tradeOpened": {
      "tradeID": "6368",
      "units": "10000"
    },
    "time": "2016-06-22T18:41:48.000000000Z"
  },
  "relatedTransactionIDs": ["6367", "6368"],
  "lastTransactionID": "6368"
}
```

For pending orders (LIMIT, STOP, etc.), `orderFillTransaction` will be absent since the order hasn't filled yet. The response only contains `orderCreateTransaction`.

---

### GET /v3/accounts/{accountID}/orders

List orders with optional filters.

**Query Parameters:**

| Param       | Type   | Default    | Description                                    |
|-------------|--------|------------|------------------------------------------------|
| `ids`       | string | --         | CSV list of order IDs                          |
| `state`     | string | `PENDING`  | `PENDING`, `FILLED`, `TRIGGERED`, `CANCELLED`, `ALL` |
| `instrument`| string | --         | Filter by instrument                           |
| `count`     | integer| `50`       | Max results (max 500)                          |
| `beforeID`  | string | --         | Pagination cursor                              |

**Response 200:**

```json
{
  "orders": [
    {
      "id": "6375",
      "createTime": "2016-06-22T18:41:29.294265338Z",
      "type": "LIMIT",
      "instrument": "EUR_USD",
      "units": "10000",
      "price": "1.12500",
      "state": "PENDING",
      "timeInForce": "GTC",
      "triggerCondition": "DEFAULT",
      "positionFill": "DEFAULT",
      "partialFill": "DEFAULT_FILL"
    }
  ],
  "lastTransactionID": "6397"
}
```

---

### GET /v3/accounts/{accountID}/pendingOrders

List only pending (unfilled) orders. No query parameters needed.

**Response 200:** Same structure as list orders, filtered to `PENDING` state.

---

### GET /v3/accounts/{accountID}/orders/{orderSpecifier}

Get a single order by ID.

**Path:** `orderSpecifier` -- order ID (e.g., `"6375"`) or client extension ID prefixed with `@` (e.g., `"@my_order_1"`)

---

### PUT /v3/accounts/{accountID}/orders/{orderSpecifier}

Replace a pending order with new parameters. The old order is cancelled and a new one is created.

**Request Body:** Same as order creation -- provide the full new order specification.

**Response 201:** Contains `orderCancelTransaction` (for the old order) and `orderCreateTransaction` (for the new order).

---

### PUT /v3/accounts/{accountID}/orders/{orderSpecifier}/cancel

Cancel a pending order.

**Response 200:**

```json
{
  "orderCancelTransaction": {
    "id": "6376",
    "type": "ORDER_CANCEL",
    "orderID": "6375",
    "reason": "CLIENT_REQUEST",
    "time": "2016-06-22T18:41:48.000000000Z"
  },
  "relatedTransactionIDs": ["6376"],
  "lastTransactionID": "6376"
}
```

---

### PUT /v3/accounts/{accountID}/orders/{orderSpecifier}/clientExtensions

Update client extension metadata on an order.

**Request Body:**

```json
{
  "clientExtensions": {
    "id": "my_order_100",
    "tag": "strategy_9",
    "comment": "Updated comment"
  },
  "tradeClientExtensions": {
    "id": "my_trade_100",
    "tag": "strategy_9",
    "comment": "Trade comment"
  }
}
```

---

## Trade Endpoints

### GET /v3/accounts/{accountID}/trades

List trades with optional filters.

**Query Parameters:**

| Param       | Type   | Default | Description                                 |
|-------------|--------|---------|---------------------------------------------|
| `ids`       | string | --      | CSV list of trade IDs                       |
| `state`     | string | `OPEN`  | `OPEN`, `CLOSED`, `CLOSE_WHEN_TRADEABLE`, `ALL` |
| `instrument`| string | --      | Filter by instrument                        |
| `count`     | integer| `50`    | Max results (max 500)                       |
| `beforeID`  | string | --      | Pagination cursor                           |

**Response 200:**

```json
{
  "trades": [
    {
      "id": "6395",
      "instrument": "EUR_USD",
      "price": "1.13033",
      "openTime": "2016-06-22T18:41:48.258142231Z",
      "state": "OPEN",
      "initialUnits": "100",
      "currentUnits": "100",
      "realizedPL": "0.00000",
      "unrealizedPL": "-0.01438",
      "financing": "0.00000",
      "dividendAdjustment": "0.00000",
      "clientExtensions": {
        "id": "my_eur_usd_trade",
        "tag": "strategy_alpha",
        "comment": "Long EUR/USD"
      }
    },
    {
      "id": "6397",
      "instrument": "USD_CAD",
      "price": "1.28241",
      "openTime": "2016-06-22T18:41:48.262344782Z",
      "state": "OPEN",
      "initialUnits": "-600",
      "currentUnits": "-600",
      "realizedPL": "0.00000",
      "unrealizedPL": "-0.08525",
      "financing": "0.00000"
    }
  ],
  "lastTransactionID": "6397"
}
```

**Notes:**

- `initialUnits` positive = long, negative = short
- `currentUnits` reflects partial closes
- `financing` = swap/rollover fees accumulated
- `dividendAdjustment` = dividend adjustments for CFDs

---

### GET /v3/accounts/{accountID}/openTrades

List only currently open trades. No query parameters needed.

**Response 200:** Same structure as above, filtered to open trades.

---

### GET /v3/accounts/{accountID}/trades/{tradeSpecifier}

Get a single trade by ID or client extension ID.

**Path:** `tradeSpecifier` -- trade ID (e.g., `"6395"`) or `@clientExtensionID` (e.g., `"@my_eur_usd_trade"`)

**Response 200:**

```json
{
  "trade": {
    "id": "6395",
    "instrument": "EUR_USD",
    "price": "1.13033",
    "openTime": "2016-06-22T18:41:48.258142231Z",
    "state": "OPEN",
    "initialUnits": "100",
    "initialMarginRequired": "2.26066",
    "currentUnits": "100",
    "realizedPL": "0.00000",
    "unrealizedPL": "-0.01438",
    "marginUsed": "2.26066",
    "financing": "0.00000",
    "dividendAdjustment": "0.00000",
    "closingTransactionIDs": [],
    "clientExtensions": {
      "id": "my_eur_usd_trade"
    },
    "takeProfitOrder": {
      "id": "6396",
      "tradeID": "6395",
      "price": "1.14000",
      "timeInForce": "GTC",
      "state": "PENDING"
    },
    "stopLossOrder": null,
    "trailingStopLossOrder": null
  },
  "lastTransactionID": "6397"
}
```

---

### PUT /v3/accounts/{accountID}/trades/{tradeSpecifier}/close

Close a trade fully or partially.

**Request Body:**

Close entirely:

```json
{
  "units": "ALL"
}
```

Partial close (close 5000 of a 10000-unit trade):

```json
{
  "units": "5000"
}
```

**Response 200:**

```json
{
  "orderCreateTransaction": {
    "id": "6401",
    "accountID": "101-004-12345678-001",
    "batchID": "6401",
    "type": "MARKET_ORDER",
    "instrument": "USD_CAD",
    "units": "600",
    "timeInForce": "FOK",
    "positionFill": "REDUCE_ONLY",
    "reason": "TRADE_CLOSE",
    "tradeClose": {
      "tradeID": "6397",
      "units": "ALL"
    },
    "time": "2016-06-22T18:41:48.291149909Z"
  },
  "orderFillTransaction": {
    "id": "6402",
    "accountID": "101-004-12345678-001",
    "batchID": "6401",
    "type": "ORDER_FILL",
    "orderID": "6401",
    "instrument": "USD_CAD",
    "units": "600",
    "price": "1.28260",
    "pl": "-0.00142",
    "financing": "0.00000",
    "accountBalance": "43650.61140",
    "reason": "MARKET_ORDER_TRADE_CLOSE",
    "tradesClosed": [
      {
        "tradeID": "6397",
        "units": "600",
        "realizedPL": "-0.00142",
        "financing": "0.00000"
      }
    ],
    "time": "2016-06-22T18:41:48.291149909Z"
  },
  "relatedTransactionIDs": ["6401", "6402"],
  "lastTransactionID": "6402"
}
```

For partial closes, the response uses `tradeReduced` instead of `tradesClosed`.

---

### PUT /v3/accounts/{accountID}/trades/{tradeSpecifier}/orders

Modify or create dependent orders (SL/TP/TSL) on an existing trade.

**Request Body:**

```json
{
  "takeProfit": {
    "price": "1.14000",
    "timeInForce": "GTC"
  },
  "stopLoss": {
    "price": "1.12000",
    "timeInForce": "GTC"
  },
  "trailingStopLoss": {
    "distance": "0.00100",
    "timeInForce": "GTC"
  }
}
```

**Behavior:**

- **Include a field** with values: creates or replaces that dependent order
- **Set a field to `null`**: cancels the existing dependent order
- **Omit a field**: leaves the existing dependent order unchanged

**Response 200:**

```json
{
  "takeProfitOrderTransaction": {
    "id": "6399",
    "type": "TAKE_PROFIT_ORDER",
    "tradeID": "6397",
    "price": "1.14000",
    "timeInForce": "GTC",
    "triggerCondition": "DEFAULT",
    "reason": "CLIENT_ORDER",
    "time": "2016-06-22T18:41:48.286484827Z"
  },
  "stopLossOrderTransaction": {
    "id": "6400",
    "type": "STOP_LOSS_ORDER",
    "tradeID": "6397",
    "price": "1.12000",
    "timeInForce": "GTC",
    "triggerCondition": "DEFAULT",
    "reason": "CLIENT_ORDER",
    "time": "2016-06-22T18:41:48.286484827Z"
  },
  "takeProfitOrderCancelTransaction": null,
  "stopLossOrderCancelTransaction": null,
  "trailingStopLossOrderTransaction": null,
  "trailingStopLossOrderCancelTransaction": null,
  "guaranteedStopLossOrderTransaction": null,
  "guaranteedStopLossOrderCancelTransaction": null,
  "relatedTransactionIDs": ["6399", "6400"],
  "lastTransactionID": "6400"
}
```

---

### PUT /v3/accounts/{accountID}/trades/{tradeSpecifier}/clientExtensions

Update client extension metadata on a trade.

**Request Body:**

```json
{
  "clientExtensions": {
    "id": "my_usd_cad_trade",
    "tag": "trade tag",
    "comment": "This is a USD/CAD trade"
  }
}
```

---

## Position Endpoints

### GET /v3/accounts/{accountID}/positions

List all positions (including instruments with zero units but historical P&L).

**Response 200:**

```json
{
  "positions": [
    {
      "instrument": "EUR_USD",
      "pl": "-54.23000",
      "resettablePL": "-54.23000",
      "unrealizedPL": "0.00000",
      "long": {
        "units": "0",
        "pl": "-54.23000",
        "resettablePL": "-54.23000",
        "unrealizedPL": "0.00000"
      },
      "short": {
        "units": "0",
        "pl": "0.00000",
        "resettablePL": "0.00000",
        "unrealizedPL": "0.00000"
      }
    }
  ],
  "lastTransactionID": "6397"
}
```

---

### GET /v3/accounts/{accountID}/openPositions

List only positions with non-zero units.

**Response 200:**

```json
{
  "positions": [
    {
      "instrument": "EUR_USD",
      "pl": "-54.23000",
      "resettablePL": "-54.23000",
      "unrealizedPL": "-0.01438",
      "long": {
        "units": "100",
        "averagePrice": "1.13033",
        "pl": "-54.23000",
        "resettablePL": "-54.23000",
        "unrealizedPL": "-0.01438",
        "tradeIDs": ["6395"]
      },
      "short": {
        "units": "0",
        "pl": "0.00000",
        "resettablePL": "0.00000",
        "unrealizedPL": "0.00000"
      }
    }
  ],
  "lastTransactionID": "6397"
}
```

**Key fields in open positions:**

- `averagePrice`: Weighted average entry price for the side
- `tradeIDs`: Array of individual trade IDs comprising the position
- `units`: Total units open on that side (`"0"` if no position)
- With hedging enabled, both `long` and `short` can have non-zero units simultaneously

---

### GET /v3/accounts/{accountID}/positions/{instrument}

Get position for a specific instrument.

**Path:** `instrument` -- e.g., `EUR_USD`

**Response 200:**

```json
{
  "position": {
    "instrument": "EUR_USD",
    "pl": "-54.23000",
    "resettablePL": "-54.23000",
    "unrealizedPL": "-0.01438",
    "long": {
      "units": "100",
      "averagePrice": "1.13033",
      "tradeIDs": ["6395"],
      "pl": "-54.23000",
      "unrealizedPL": "-0.01438"
    },
    "short": {
      "units": "0",
      "pl": "0.00000",
      "unrealizedPL": "0.00000"
    }
  },
  "lastTransactionID": "6397"
}
```

---

### PUT /v3/accounts/{accountID}/positions/{instrument}/close

Close a position by instrument (long side, short side, or both).

**Request Body:**

Close all longs:

```json
{
  "longUnits": "ALL"
}
```

Close all shorts:

```json
{
  "shortUnits": "ALL"
}
```

Close specific number of long units:

```json
{
  "longUnits": "5000"
}
```

Close both sides:

```json
{
  "longUnits": "ALL",
  "shortUnits": "ALL"
}
```

**Response 200:**

```json
{
  "longOrderCreateTransaction": {
    "id": "6403",
    "type": "MARKET_ORDER",
    "instrument": "EUR_USD",
    "units": "-100",
    "reason": "POSITION_CLOSEOUT",
    "longPositionCloseout": {
      "instrument": "EUR_USD",
      "units": "ALL"
    },
    "time": "2016-06-22T18:41:48.000000000Z"
  },
  "longOrderFillTransaction": {
    "id": "6404",
    "type": "ORDER_FILL",
    "instrument": "EUR_USD",
    "units": "-100",
    "price": "1.13028",
    "pl": "-0.00500",
    "accountBalance": "43650.60640",
    "reason": "MARKET_ORDER_POSITION_CLOSEOUT",
    "tradesClosed": [
      {
        "tradeID": "6395",
        "units": "-100",
        "realizedPL": "-0.00500"
      }
    ],
    "time": "2016-06-22T18:41:48.000000000Z"
  },
  "shortOrderCreateTransaction": null,
  "shortOrderFillTransaction": null,
  "shortOrderCancelTransaction": null,
  "relatedTransactionIDs": ["6403", "6404"],
  "lastTransactionID": "6404"
}
```

---

## Transaction Endpoints

### GET /v3/accounts/{accountID}/transactions

Get a page index of transactions within a time range.

**Query Parameters:**

| Param    | Type     | Default | Description                                          |
|----------|----------|---------|------------------------------------------------------|
| `from`   | DateTime | --      | Start time                                           |
| `to`     | DateTime | --      | End time                                             |
| `pageSize`| integer | `100`   | Results per page (max 1000)                          |
| `type`   | string   | --      | CSV of transaction type filters                      |

**Response 200:**

```json
{
  "from": "2016-06-01T00:00:00.000000000Z",
  "to": "2016-07-01T00:00:00.000000000Z",
  "pageSize": 100,
  "count": 1234,
  "pages": [
    "https://api-fxpractice.oanda.com/v3/accounts/101-004-12345678-001/transactions/idrange?from=6356&to=6357"
  ],
  "lastTransactionID": "6397"
}
```

The `pages` array contains URLs you fetch to retrieve the actual transactions.

---

### GET /v3/accounts/{accountID}/transactions/{transactionID}

Get a single transaction by ID.

**Response 200:**

```json
{
  "transaction": {
    "id": "6368",
    "accountID": "101-004-12345678-001",
    "userID": 12345678,
    "type": "ORDER_FILL",
    "time": "2016-06-22T18:41:48.000000000Z",
    "orderID": "6367",
    "instrument": "EUR_USD",
    "units": "10000",
    "price": "1.13033",
    "pl": "0.00000",
    "financing": "0.00000",
    "accountBalance": "43650.78835"
  },
  "lastTransactionID": "6397"
}
```

---

### GET /v3/accounts/{accountID}/transactions/idrange

Get transactions by ID range.

**Query Parameters:**

| Param  | Type          | Required | Description          |
|--------|---------------|----------|----------------------|
| `from` | TransactionID | Yes      | Start transaction ID |
| `to`   | TransactionID | Yes      | End transaction ID   |
| `type` | string        | No       | CSV type filter      |

**Response 200:**

```json
{
  "transactions": [ /* array of Transaction objects */ ],
  "lastTransactionID": "6397"
}
```

---

### GET /v3/accounts/{accountID}/transactions/sinceid

Get transactions since a specific transaction ID.

**Query Parameters:**

| Param  | Type          | Required | Description                   |
|--------|---------------|----------|-------------------------------|
| `id`   | TransactionID | Yes      | Return transactions after this |
| `type` | string        | No       | CSV type filter               |

---

## Streaming Endpoints

There are two streaming endpoints, both using chunked transfer encoding:

### Price Streaming

```
GET https://stream-fxpractice.oanda.com/v3/accounts/{accountID}/pricing/stream?instruments=EUR_USD,USD_JPY
```

See [Pricing Endpoints](#get-v3accountsaccountidpricingstream) above for full details.

### Transaction Streaming

```
GET https://stream-fxpractice.oanda.com/v3/accounts/{accountID}/transactions/stream
```

Streams real-time transaction notifications. Two object types:

**Transaction object (varies by type):**

```json
{
  "type": "ORDER_FILL",
  "id": "6368",
  "accountID": "101-004-12345678-001",
  "time": "2016-06-22T18:41:48.000000000Z",
  "instrument": "EUR_USD",
  "units": "10000",
  "price": "1.13033"
}
```

**Heartbeat (every 5 seconds):**

```json
{
  "type": "HEARTBEAT",
  "lastTransactionID": "6397",
  "time": "2016-06-22T18:41:53.000000000Z"
}
```

### Streaming Implementation Notes

1. **Use streaming base URLs** (`stream-fxpractice` / `stream-fxtrade`), NOT the REST base URLs
2. **Chunked transfer encoding**: each JSON object is on its own line, separated by newlines
3. **Heartbeats every 5 seconds**: if you don't receive any data (price or heartbeat) for >10 seconds, the connection is likely dead -- reconnect
4. **Max 20 active streams** per IP address
5. **Max 2 new connections/second** per IP
6. **~4 price updates/second** per instrument maximum
7. **Keep the connection open**: do not repeatedly open/close connections. Open once, read continuously.
8. **Handle reconnection**: network drops happen. Implement exponential backoff reconnection logic.

---

## Enums and Type Reference

### CandlestickGranularity

| Value | Duration       | Alignment |
|-------|----------------|-----------|
| S5    | 5 seconds      | minute    |
| S10   | 10 seconds     | minute    |
| S15   | 15 seconds     | minute    |
| S30   | 30 seconds     | minute    |
| M1    | 1 minute       | minute    |
| M2    | 2 minutes      | hour      |
| M4    | 4 minutes      | hour      |
| M5    | 5 minutes      | hour      |
| M10   | 10 minutes     | hour      |
| M15   | 15 minutes     | hour      |
| M30   | 30 minutes     | hour      |
| H1    | 1 hour         | hour      |
| H2    | 2 hours        | day       |
| H3    | 3 hours        | day       |
| H4    | 4 hours        | day       |
| H6    | 6 hours        | day       |
| H8    | 8 hours        | day       |
| H12   | 12 hours       | day       |
| D     | 1 day          | day       |
| W     | 1 week         | start of week |
| M     | 1 month        | 1st of month  |

### TimeInForce

| Value | Name                | Description                                       |
|-------|---------------------|---------------------------------------------------|
| GTC   | Good Till Cancelled | Remains until filled or cancelled                 |
| GTD   | Good Till Date      | Remains until `gtdTime` or cancelled              |
| GFD   | Good For Day        | Remains until end of current trading day           |
| FOK   | Fill or Kill        | Fill completely immediately or cancel entirely     |
| IOC   | Immediate or Cancel | Fill as much as possible immediately, cancel rest  |

**Usage by order type:**

- Market orders: `FOK` (default and required)
- Limit/Stop/MarketIfTouched: `GTC` (default), `GTD`, or `GFD`
- TakeProfit/StopLoss/TrailingStopLoss: `GTC` (default) or `GTD`

### OrderType

| Value                | Description                                          |
|----------------------|------------------------------------------------------|
| MARKET               | Immediate fill at current price                      |
| LIMIT                | Fill at specified price or better                    |
| STOP                 | Trigger at price, fill at market                     |
| MARKET_IF_TOUCHED    | Like limit, but guarantees fill not price            |
| TAKE_PROFIT          | Close trade at profit target                         |
| STOP_LOSS            | Close trade at loss limit                            |
| GUARANTEED_STOP_LOSS | Close trade at exact price (premium)                 |
| TRAILING_STOP_LOSS   | Follows price at fixed distance                      |
| FIXED_PRICE          | Internal use only                                    |

### OrderState

| Value               | Description                                     |
|---------------------|-------------------------------------------------|
| PENDING             | Not yet triggered/filled                        |
| FILLED              | Fully executed                                  |
| TRIGGERED           | Triggered but not yet filled                    |
| CANCELLED           | Cancelled before fill                           |

### TradeState

| Value                | Description                                     |
|----------------------|-------------------------------------------------|
| OPEN                 | Currently active                                |
| CLOSED               | Fully closed                                    |
| CLOSE_WHEN_TRADEABLE | Will close when market reopens                  |

### OrderPositionFill

| Value        | Description                                               |
|--------------|-----------------------------------------------------------|
| DEFAULT      | Platform default behavior                                 |
| OPEN_ONLY    | Only open new positions, never reduce existing            |
| REDUCE_FIRST | Reduce opposing position first, then open if units remain |
| REDUCE_ONLY  | Only reduce existing positions, never open new            |

### OrderTriggerCondition

| Value   | Description                                                    |
|---------|----------------------------------------------------------------|
| DEFAULT | Trigger on ask for buy orders, bid for sell orders             |
| INVERSE | Trigger on ask for sell orders, bid for buy orders             |
| BID     | Always trigger on bid price                                    |
| ASK     | Always trigger on ask price                                    |
| MID     | Trigger on midpoint price                                      |

### PriceStatus

| Value          | Description                        |
|----------------|------------------------------------|
| tradeable      | Can be traded                      |
| non-tradeable  | Market closed                      |
| invalid        | Invalid instrument or no price     |

### InstrumentType

| Value    | Description            |
|----------|------------------------|
| CURRENCY | Forex pairs            |
| CFD      | Contracts for Difference |
| METAL    | Precious metals        |

### Direction

| Value | Description |
|-------|-------------|
| LONG  | Buy units   |
| SHORT | Sell units  |

---

## Error Handling

### HTTP Status Codes

| Code | Meaning            | Typical Cause                                    |
|------|--------------------|--------------------------------------------------|
| 200  | OK                 | Successful GET/PUT/PATCH                         |
| 201  | Created            | Order successfully created                       |
| 400  | Bad Request        | Invalid parameters, precision exceeded           |
| 401  | Unauthorized       | Missing/invalid Bearer token                     |
| 403  | Forbidden          | Account not tradeable, insufficient permissions  |
| 404  | Not Found          | Invalid account/order/trade ID                   |
| 405  | Method Not Allowed | Wrong HTTP method for endpoint                   |
| 416  | Range Not Satisfiable | Transaction ID out of range                   |
| 429  | Too Many Requests  | Rate limit exceeded (120 req/s)                  |

### Error Response Format

```json
{
  "errorCode": "INVALID_INSTRUMENT",
  "errorMessage": "Invalid value specified for 'instrument'"
}
```

For order rejections:

```json
{
  "orderRejectTransaction": {
    "id": "6369",
    "type": "MARKET_ORDER_REJECT",
    "reason": "STOP_LOSS_ON_FILL_PRICE_PRECISION_EXCEEDED",
    "rejectReason": "STOP_LOSS_ON_FILL_PRICE_PRECISION_EXCEEDED"
  },
  "relatedTransactionIDs": ["6369"],
  "lastTransactionID": "6369",
  "errorCode": "STOP_LOSS_ON_FILL_PRICE_PRECISION_EXCEEDED",
  "errorMessage": "The Stop Loss on Fill price precision exceeds the allowed precision"
}
```

### Common Error Scenarios

| Error                                        | Cause                                   | Fix                                           |
|----------------------------------------------|-----------------------------------------|-----------------------------------------------|
| `PRECISION_EXCEEDED`                         | Price has too many decimals             | Match instrument's `displayPrecision`         |
| `STOP_LOSS_ON_FILL_PRICE_PRECISION_EXCEEDED` | SL price has too many decimals          | Match instrument's `displayPrecision`         |
| `INSUFFICIENT_MARGIN`                        | Not enough margin for the trade         | Reduce units or close other positions         |
| `MARKET_HALTED`                              | Market is closed                        | Wait for market to reopen                     |
| `NO_SUCH_TRADE`                              | Trade ID doesn't exist                  | Verify trade ID is current and correct        |
| `NO_SUCH_ORDER`                              | Order ID doesn't exist                  | Verify order ID is current and correct        |
| `INSUFFICIENT_LIQUIDITY`                     | Not enough liquidity for order size     | Reduce order size                             |

### 429 Rate Limit Handling

When you receive HTTP 429, back off and retry. Recommended approach:

1. On 429, wait 1 second before retrying
2. If still 429, exponential backoff (2s, 4s, 8s)
3. Never exceed 120 requests/second sustained

---

## Quick Reference -- Common Workflows

### Open a Long EUR_USD Trade with SL/TP

```
POST /v3/accounts/{accountID}/orders
Content-Type: application/json
Authorization: Bearer <TOKEN>

{
  "order": {
    "type": "MARKET",
    "instrument": "EUR_USD",
    "units": "10000",
    "timeInForce": "FOK",
    "positionFill": "DEFAULT",
    "takeProfitOnFill": {
      "price": "1.14000",
      "timeInForce": "GTC"
    },
    "stopLossOnFill": {
      "price": "1.12000",
      "timeInForce": "GTC"
    }
  }
}
```

### Open a Short EUR_USD Trade

```
POST /v3/accounts/{accountID}/orders

{
  "order": {
    "type": "MARKET",
    "instrument": "EUR_USD",
    "units": "-10000",
    "timeInForce": "FOK",
    "positionFill": "DEFAULT"
  }
}
```

### Get Current Price

```
GET /v3/accounts/{accountID}/pricing?instruments=EUR_USD
Authorization: Bearer <TOKEN>
```

### Get H1 Candles (last 100)

```
GET /v3/instruments/EUR_USD/candles?granularity=H1&count=100&price=MBA
Authorization: Bearer <TOKEN>
```

### Get Historical Candles by Date Range

```
GET /v3/instruments/EUR_USD/candles?granularity=M15&from=2026-03-01T00:00:00Z&to=2026-03-15T00:00:00Z&price=MBA
Authorization: Bearer <TOKEN>
```

### Modify SL/TP on Existing Trade

```
PUT /v3/accounts/{accountID}/trades/{tradeID}/orders
Content-Type: application/json
Authorization: Bearer <TOKEN>

{
  "takeProfit": {
    "price": "1.15000",
    "timeInForce": "GTC"
  },
  "stopLoss": {
    "price": "1.11500",
    "timeInForce": "GTC"
  }
}
```

### Close a Trade

```
PUT /v3/accounts/{accountID}/trades/{tradeID}/close
Content-Type: application/json
Authorization: Bearer <TOKEN>

{
  "units": "ALL"
}
```

### Close All Longs for an Instrument

```
PUT /v3/accounts/{accountID}/positions/EUR_USD/close
Content-Type: application/json
Authorization: Bearer <TOKEN>

{
  "longUnits": "ALL"
}
```

### Stream Live Prices

```
GET /v3/accounts/{accountID}/pricing/stream?instruments=EUR_USD,USD_JPY
Authorization: Bearer <TOKEN>
Host: stream-fxpractice.oanda.com
```

### Poll for Account Changes

```
GET /v3/accounts/{accountID}/changes?sinceTransactionID=6397
Authorization: Bearer <TOKEN>
```
