import sourcePolicy from '../config/source-policy.json';

export type SourceRole = 'basemap' | 'imagery';

type SourceContract = {
  scheme: string;
  host: string;
  port: number;
  path_template: string;
  layer: string;
  format: string;
  attribution: string;
};

export type SourceRequest = {
  url: string;
  layer: string;
  format: string;
};

type ValidationFailure = {
  ok: false;
  code: 'MALFORMED_URL' | 'ORIGIN' | 'SCHEME' | 'LAYER' | 'FORMAT' | 'PATH_TEMPLATE';
  message: string;
};

type ValidationSuccess = {
  ok: true;
  role: SourceRole;
  url: URL;
};

export type SourceRequestValidation = ValidationFailure | ValidationSuccess;

const policyRoles = sourcePolicy.roles as Record<SourceRole, { contract: SourceContract }>;

function contractFor(role: SourceRole): SourceContract {
  return policyRoles[role].contract;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templatePattern(template: string): RegExp {
  const parts = template.split(/(\{[xyz]\})/g);
  const pattern = parts
    .map((part) => {
      if (/^\{[xyz]\}$/.test(part)) {
        return '[0-9]+';
      }
      return escapeRegExp(part);
    })
    .join('');
  return new RegExp(`^${pattern}$`);
}

function expectedOrigin(contract: SourceContract): string {
  return new URL(`${contract.scheme}://${contract.host}:${contract.port}`).origin;
}

export function validateSourceRequest(
  role: SourceRole,
  request: SourceRequest,
): SourceRequestValidation {
  const contract = contractFor(role);
  let url: URL;

  try {
    url = new URL(request.url);
  } catch {
    return {
      ok: false,
      code: 'MALFORMED_URL',
      message: 'Source URL is not a valid absolute URL.',
    };
  }

  if (url.protocol !== `${contract.scheme}:`) {
    return {
      ok: false,
      code: 'SCHEME',
      message: `Source scheme must be ${contract.scheme}.`,
    };
  }

  if (url.origin !== expectedOrigin(contract)) {
    return {
      ok: false,
      code: 'ORIGIN',
      message: `Source origin must be ${expectedOrigin(contract)}.`,
    };
  }

  if (url.search || url.hash || url.username || url.password) {
    return {
      ok: false,
      code: 'PATH_TEMPLATE',
      message: 'Source URL must contain only the approved path template.',
    };
  }

  if (request.layer !== contract.layer) {
    return {
      ok: false,
      code: 'LAYER',
      message: `Source layer must be ${contract.layer}.`,
    };
  }

  if (request.format !== contract.format) {
    return {
      ok: false,
      code: 'FORMAT',
      message: `Source format must be ${contract.format}.`,
    };
  }

  if (!templatePattern(contract.path_template).test(url.pathname)) {
    return {
      ok: false,
      code: 'PATH_TEMPLATE',
      message: 'Source path must match the approved policy template.',
    };
  }

  return { ok: true, role, url };
}

export function assertApprovedSourceRequest(
  role: SourceRole,
  request: SourceRequest,
): URL {
  const result = validateSourceRequest(role, request);
  if (!result.ok) {
    throw new Error(`Unapproved ${role} source request: ${result.message}`);
  }
  return result.url;
}

function expandTemplate(
  template: string,
  coordinates: { z: number; x: number; y: number },
): string {
  return template.replace(/\{([xyz])\}/g, (_, key: 'x' | 'y' | 'z') =>
    String(coordinates[key]),
  );
}

function policyOrigin(contract: SourceContract): string {
  return expectedOrigin(contract);
}

export function basemapTileUrl(z: number, x: number, y: number): string {
  if (![z, x, y].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError('Basemap tile coordinates must be non-negative safe integers.');
  }

  const contract = contractFor('basemap');
  const path = expandTemplate(contract.path_template, { z, x, y });
  const url = `${policyOrigin(contract)}${path}`;

  assertApprovedSourceRequest('basemap', {
    url,
    layer: contract.layer,
    format: contract.format,
  });

  return url;
}

export function composeAttribution(active: {
  basemap: boolean;
  imagery: boolean;
}): string {
  const attributions: string[] = [];
  if (active.basemap) {
    attributions.push(contractFor('basemap').attribution);
  }
  if (active.imagery) {
    attributions.push(contractFor('imagery').attribution);
  }
  return attributions.join(' · ');
}
