import { DestinationRefusedError } from "../errors.ts";
import type { SourceNetwork } from "../source.ts";

/**
 * Checks a URL against a source's declared network before anything is sent:
 * the declared scheme, no credentials in the URL, the default port, and a
 * host on the source's exact allowlist. An IP literal never matches, because
 * declared hosts are DNS names. Every redirect hop is checked again, so a
 * chain cannot leave the allowlist.
 */
export function checkDestination(rawUrl: string, network: SourceNetwork): URL {
  if (!URL.canParse(rawUrl)) throw new DestinationRefusedError("MALFORMED_URL", "not a URL");
  const url = new URL(rawUrl);
  if (url.protocol !== `${network.protocol}:`) {
    throw new DestinationRefusedError(
      "SCHEME_NOT_ALLOWED",
      `the source allows ${network.protocol} only`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new DestinationRefusedError("CREDENTIALS_IN_URL", "a URL may not carry credentials");
  }
  if (!network.hosts.includes(url.hostname)) {
    throw new DestinationRefusedError(
      "HOST_NOT_ALLOWED",
      `${url.hostname} is not one of the source's declared hosts`,
    );
  }
  if (url.port !== "") {
    throw new DestinationRefusedError("PORT_NOT_ALLOWED", "only the scheme's default port");
  }
  return url;
}
