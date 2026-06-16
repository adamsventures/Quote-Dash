export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
      return new Response(JSON.stringify({ error: 'Google credentials not set. Visit /oauth/authorize first.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Exchange refresh token for a fresh access token
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });
    const tokenData = await tokenResp.json();
    if (tokenData.error) {
      return new Response(JSON.stringify({ error: `Google auth failed: ${tokenData.error_description}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Inject access token into MCP server config
    const bodyJson = await request.json();
    if (bodyJson.mcp_servers) {
      bodyJson.mcp_servers = bodyJson.mcp_servers.map(s => ({
        ...s,
        authorization_token: `Bearer ${tokenData.access_token}`
      }));
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify(bodyJson)
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Unknown proxy error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
