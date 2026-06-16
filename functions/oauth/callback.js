export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const html = (title, body) => new Response(`
    <html>
    <head><style>
      body{font-family:-apple-system,sans-serif;padding:32px;background:#1e1e1c;color:#f0efeb;max-width:640px;margin:0 auto;}
      h2{margin-bottom:12px;} textarea{width:100%;height:80px;background:#2a2a28;color:#f0efeb;border:1px solid #444;padding:10px;font-family:monospace;font-size:13px;border-radius:6px;}
      p{color:#b0b0ac;} strong{color:#f0efeb;}
    </style></head>
    <body><h2>${title}</h2>${body}</body>
    </html>`, { headers: { 'Content-Type': 'text/html' } });

  if (error) return html('❌ Authorization failed', `<p>${error}</p>`);
  if (!code) return html('❌ No code received', '<p>Something went wrong. Try again.</p>');

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://quote-dash.pages.dev/oauth/callback',
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenResp.json();

    if (tokens.error) {
      return html('❌ Token error', `<p>${tokens.error}: ${tokens.error_description}</p>`);
    }

    return html('✅ Authorization successful!', `
      <p>Copy this refresh token and add it to Cloudflare as <strong>GOOGLE_REFRESH_TOKEN</strong>:</p>
      <textarea onclick="this.select()">${tokens.refresh_token}</textarea>
      <p style="margin-top:16px;">After adding it to Cloudflare, redeploy and you're done.</p>
    `);
  } catch (e) {
    return html('❌ Error', `<p>${e.message}</p>`);
  }
}
