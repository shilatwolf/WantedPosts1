const JOBS_URL = 'https://careers.overwolf.com/api/jobs';

// Suffixes stripped from titles because the tool already surfaces them
// as sublabel chips or brand filters. Order matters — more specific first.
// sublabel: '' means strip-only (no auto-select).
const SUFFIX_MAP = [
  // Work arrangement — strip AND auto-select sublabel chip
  { pattern: /maternity\s+leave\s+cover/i, sublabel: 'Maternity Leave Cover *' },
  { pattern: /part[-\s]time/i,             sublabel: 'Part Time *'             },
  { pattern: /uk\s+based/i,               sublabel: 'UK Based *'              },
  { pattern: /us\s+based/i,               sublabel: 'US Based *'              },
  { pattern: /remote/i,                   sublabel: 'Remote *'                },
  { pattern: /hybrid/i,                   sublabel: 'Hybrid *'                },
  // Brand qualifiers — strip only (brand is already captured in the brand filter)
  { pattern: /overwolf\s+ads?/i,          sublabel: ''                        },
  { pattern: /brand\s+partnerships?/i,    sublabel: ''                        },
  { pattern: /curseforge/i,              sublabel: ''                        },
  { pattern: /outplayed/i,              sublabel: ''                        },
  { pattern: /tebex/i,                  sublabel: ''                        },
];

// Remove any known redundant suffix after a dash / pipe / comma separator.
function cleanTitle(raw) {
  let title = raw;
  for (const { pattern } of SUFFIX_MAP) {
    title = title.replace(
      new RegExp('\\s*[-–|/,]\\s*' + pattern.source + '\\s*$', 'i'),
      ''
    );
  }
  return title.trim();
}

// Return the sublabel chip value implied by the raw title suffix, if any.
function titleSublabel(raw) {
  for (const { pattern, sublabel } of SUFFIX_MAP) {
    if (new RegExp('[-–|/,]\\s*' + pattern.source + '\\s*$', 'i').test(raw)) {
      return sublabel;
    }
  }
  return '';
}

exports.handler = async () => {
  try {
    const res = await fetch(JOBS_URL);

    if (!res.ok) {
      console.error('[jobs] upstream error:', res.status);
      return respond(200, { positions: [] });
    }

    const data = await res.json();

    const positions = data
      .map(p => {
        const raw = p.name || '';
        return {
          title:         cleanTitle(raw),
          department:    p.department || '',
          location:      [p.location && p.location.city, p.workplace_type].filter(Boolean).join(' · '),
          workplaceType: p.workplace_type || '',
          sublabelHint:  titleSublabel(raw),   // from title suffix (priority)
          brand:         deriveBrand(raw),
        };
      })
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
