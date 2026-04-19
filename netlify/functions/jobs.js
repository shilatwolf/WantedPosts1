const JOBS_URL = 'https://careers.overwolf.com/api/jobs';

exports.handler = async () => {
  try {
    const res = await fetch(JOBS_URL);

    if (!res.ok) {
      console.error('[jobs] upstream error:', res.status);
      return respond(200, { positions: [] });
    }

    const data = await res.json();

    const positions = data
      .map(p => ({
        title:      p.name || '',
        department: p.department || '',
        location:   [p.location && p.location.city, p.workplace_type]
                      .filter(Boolean).join(' · '),
        brand:      deriveBrand(p.name || ''),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    return respond(200, { positions });

  } catch (err) {
    console.error('[jobs] fetch failed:', err.message);
    return respond(200, { positions: [] });
  }
};

function deriveBrand(title) {
  if (/tebex/i.test(title))     return 'tebex';
  if (/outplayed/i.test(title)) return 'outplayed';
  return 'overwolf';
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
