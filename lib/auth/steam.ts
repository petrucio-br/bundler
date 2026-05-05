// Steam OpenID 2.0 helpers.
// Steam's OpenID is the legacy 2.0 spec. The flow:
//   1. Redirect user to https://steamcommunity.com/openid/login with our return URL.
//   2. Steam redirects back to our callback with openid.* query params.
//   3. We POST those params back to Steam with openid.mode=check_authentication to verify.
//   4. Steam responds "is_valid:true" or "is_valid:false".
//   5. If valid, extract SteamID64 from openid.claimed_id (looks like https://steamcommunity.com/openid/id/76561198XXXXXXXXX).

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

export function buildSteamLoginUrl(baseUrl: string): string {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${baseUrl}/api/auth/steam/callback`,
    "openid.realm": baseUrl,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

/**
 * Verify a Steam OpenID callback by replaying the params back to Steam.
 * Returns the SteamID64 string if valid, null otherwise.
 */
export async function verifySteamCallback(
  searchParams: URLSearchParams
): Promise<string | null> {
  // Take everything Steam sent back, change mode to check_authentication, POST it back.
  const verifyParams = new URLSearchParams(searchParams);
  verifyParams.set("openid.mode", "check_authentication");

  const response = await fetch(STEAM_OPENID_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: verifyParams.toString(),
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.text();
  // Steam responds with key:value lines including "is_valid:true" or "is_valid:false".
  const isValid = /is_valid\s*:\s*true/i.test(body);
  if (!isValid) {
    return null;
  }

  const claimedId = searchParams.get("openid.claimed_id");
  if (!claimedId) return null;
  const match = claimedId.match(STEAM_CLAIMED_ID_RE);
  if (!match) return null;
  return match[1];
}
