/**
 * The lake's S3 credentials (AIStor), read from the environment at every use.
 *
 * There is deliberately no default: the values live in the secrets store
 * (`dotfiles/secrets/secrets.env`, applied as User environment variables), and a
 * credential written into code is published with the code. A process started
 * without them fails at its first lake request, naming what is missing.
 */
export function lakeCredentials(): { accessKey: string; secretKey: string } {
  const accessKey = process.env.MINIO_USER;
  const secretKey = process.env.MINIO_PASSWORD;
  if (!accessKey || !secretKey) {
    throw new Error('MINIO_USER and MINIO_PASSWORD must be set in the environment: the lake credentials never come from code');
  }
  return { accessKey, secretKey };
}
