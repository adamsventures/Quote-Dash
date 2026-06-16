function findPdfs(parts, result) {
  if (!parts) return;
  for (const part of parts) {
    if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
      result.push({ attachmentId: part.body.attachmentId });
    }
    if (part.parts) findPdfs(part.parts, result);
  }
}

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
    const accessToken = tokenData.access_token;

    const { prompt } = await request.json();

    // Search Gmail for matching emails (most recent first, up to 20)
    const query = 'from:ahb@kgssteel.com subject:"Daily Quotes for Whs 1"';
    const listResp = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listResp.json();
    if (listData.error) {
      return new Response(JSON.stringify({ error: `Gmail search failed: ${listData.error.message}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
    const messages = listData.messages || [];

    if (!messages.length) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"emails_found":0,"emails_processed":0,"quotes":[]}' }]
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Fetch all message details in parallel
    const msgDetails = await Promise.all(
      messages.map(msg =>
        fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }).then(r => r.json())
      )
    );

    // Deduplicate by calendar date — keep only the latest email per date
    const dateMap = new Map();
    for (const msgData of msgDetails) {
      const internalDate = parseInt(msgData.internalDate);
      const dateKey = new Date(internalDate).toISOString().slice(0, 10);
      const pdfParts = [];
      findPdfs(msgData.payload?.parts, pdfParts);
      if (pdfParts.length > 0) {
        const existing = dateMap.get(dateKey);
        if (!existing || internalDate > existing.internalDate) {
          dateMap.set(dateKey, { internalDate, msgId: msgData.id, pdfParts });
        }
      }
    }

    // Download all PDF attachments in parallel
    const docEntries = await Promise.all(
      Array.from(dateMap.entries()).map(async ([date, { msgId, pdfParts }]) => {
        const b64s = await Promise.all(
          pdfParts.map(({ attachmentId }) =>
            fetch(
              `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attachmentId}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            ).then(r => r.json()).then(d => d.data.replace(/-/g, '+').replace(/_/g, '/'))
          )
        );
        return { date, b64s };
      })
    );

    // Build Claude document content blocks
    const documents = [];
    for (const { b64s } of docEntries) {
      for (const b64 of b64s) {
        documents.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: b64 }
        });
      }
    }

    if (!documents.length) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: `{"emails_found":${messages.length},"emails_processed":0,"quotes":[],"error":"No PDF attachments found in emails"}` }]
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Call Claude with PDFs as document attachments — no MCP needed
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [...documents, { type: 'text', text: prompt }]
        }]
      })
    });

    return new Response(claudeResp.body, {
      status: claudeResp.status,
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
