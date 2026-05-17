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
          // Raw title for title-based suggestion matching (e.g. "maternity")
          rawName:         raw,
          title:           cleanTitle(raw),
          department:      p.department || '',
          // Human-readable summary, used by the chip row
          location:        [p.location && p.location.city, p.workplace_type].filter(Boolean).join(' · '),
          // Structured fields for the position-detail strip + extractSuggestions
          city:            (p.location && p.location.city) || '',
          country:         (p.location && p.location.country) || '',
          isRemote:        !!(p.location && p.location.is_remote),
          workplaceType:   p.workplace_type || '',
          employmentType:  p.employment_type || '',
          experienceLevel: p.experience_level || '',
          sublabelHint:    titleSublabel(raw),   // from title suffix (priority)
          brand:           deriveBrand(raw, p.department || ''),
          // Referral bridge (§9) — link to Comeet's page where the employee
          // authenticates to get a personal ?ref= token.  Reward amount is
          // surfaced in the nudge if present.
          urlActivePage:   p.url_active_page || '',
          referralReward:  p.company_referrals_reward || '',
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    return respond(200, { positions });

  } catch (err) {
    console.error('[jobs] fetch failed:', err.message);
    return respond(200, { positions: [] });
  }
};

function deriveBrand(title, department) {
  // Title-based detection — explicit suffix convention, most specific.
  if (/overwolf\s+ads?/i.test(title))         return 'overwolfads';
  if (/brand\s+partnerships?/i.test(title))   return 'overwolfads';
  if (/curseforge/i.test(title))              return 'curseforge';
  if (/tebex/i.test(title))                   return 'tebex';
  if (/outplayed/i.test(title))               return 'outplayed';
  // Department fallback for positions where the title doesn't carry the brand.
  const DEPT_TO_BRAND = {
    'Overwolf Ads':       'overwolfads',
    'Brand Partnerships': 'overwolfads',
    'CurseForge':         'curseforge',
    'Tebex':              'tebex',
    'Outplayed':          'outplayed',
  };
  if (DEPT_TO_BRAND[department]) return DEPT_TO_BRAND[department];
  return 'overwolf';
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
