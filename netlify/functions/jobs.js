const COMPANY_UID = 'B1.001';
const COMEET_URL  = `https://www.comeet.co/careers-api/2.0/company/${COMPANY_UID}/positions`;

exports.handler = async () => {
  const token = process.env.COMEET_TOKEN;

  if (!token) {
    return respond(200, { positions: [] });
  }

  try {
    const res = await fetch(`${COMEET_URL}?token=${token}&details=false`);

    if (!res.ok) {
      console.error('[jobs] Comeet API error:', res.status, await res.text());
      return respond(200, { positions: [] });
    }

    const data = await res.json();

    const positions = data
      .filter(p => p.is_published)
      .map(p => ({
        title:      p.name      || '',
        department: p.department || '',
        location:   (p.location && p.location.name) || '',
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    return respond(200, { positions });

  } catch (err) {
    console.error('[jobs] fetch failed:', err.message);
    return respond(200, { positions: [] });
  }
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
