export async function onRequestGet(context) {
  const { env } = context;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: 'https://quote-dash.pages.dev/oauth/callback',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent'
  });

  return Response.redirect(`https://accounts.google.com/o/oauth2/auth?${params}`, 302);
}
