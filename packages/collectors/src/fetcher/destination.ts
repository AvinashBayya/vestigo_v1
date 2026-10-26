import { DestinationRefusedError } from "../errors.ts";
import { forbiddenPlatformDomainOf, type SourceNetwork } from "../source.ts";

/**
 * Checks a URL against a source's network before anything is sent: the declared
 * scheme, no credentials in the URL, the default port, and a host on the
 * allowed set. `allowedHosts` is the source's static `hosts` by default; an
 * open-host source hands the one authorised host it may contact for this run
 * (see fetcher.ts / runtime.ts). An IP literal never matches, because the
 * allowed hosts are DNS names. Every redirect hop is checked again, so a chain
 * cannot leave the allowed set. Instagram, Facebook and X are never contacted
 * by any source or host (CLAUDE.md §3); a static source's hosts are checked at
 * declaration, and this is the backstop for an open-host one.
 */
export function checkDestination(
  rawUrl: string,
  network: SourceNetwork,
  allowedHosts: readonly string[] = network.hosts,
): URL {
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
  if (!allowedHosts.includes(url.hostname)) {
    throw new DestinationRefusedError(
      "HOST_NOT_ALLOWED",
      `${url.hostname} is not one of the allowed hosts`,
    );
  }
  const forbidden = forbiddenPlatformDomainOf(url.hostname);
  if (forbidden !== null) {
    throw new DestinationRefusedError(
      "HOST_NOT_ALLOWED",
      `${url.hostname} is under ${forbidden}, which is never contacted`,
    );
  }
  if (url.port !== "") {
    throw new DestinationRefusedError("PORT_NOT_ALLOWED", "only the scheme's default port");
  }
  return url;
}
