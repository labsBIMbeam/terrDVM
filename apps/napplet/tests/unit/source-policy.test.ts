import sourcePolicy from '../../src/config/source-policy.json';
import {
  assertApprovedSourceRequest,
  basemapTileUrl,
  composeAttribution,
} from '../../src/map/source';

const roles = ['basemap', 'imagery'] as const;
type Role = (typeof roles)[number];

function policyUrl(role: Role, path: string): string {
  const contract = sourcePolicy.roles[role].contract;
  return `${contract.scheme}://${contract.host}:${contract.port}${path}`;
}

function templatePath(role: Role): string {
  return sourcePolicy.roles[role].contract.path_template
    .replace('{z}', '3')
    .replace('{x}', '4')
    .replace('{y}', '5');
}

describe('source policy', () => {
  it.each(roles)('rejects an unapproved origin for the %s role', (role) => {
    expect(() =>
      assertApprovedSourceRequest(role, {
        url: `https://unapproved.example${templatePath(role)}`,
        layer: sourcePolicy.roles[role].contract.layer,
        format: sourcePolicy.roles[role].contract.format,
      }),
    ).toThrow(/origin/i);
  });

  it.each(roles)('rejects an HTTP downgrade for the %s role', (role) => {
    const contract = sourcePolicy.roles[role].contract;
    expect(() =>
      assertApprovedSourceRequest(role, {
        url: `http://${contract.host}:${contract.port}${templatePath(role)}`,
        layer: contract.layer,
        format: contract.format,
      }),
    ).toThrow(/scheme/i);
  });

  it.each(roles)('rejects an unapproved layer for the %s role', (role) => {
    expect(() =>
      assertApprovedSourceRequest(role, {
        url: policyUrl(role, templatePath(role)),
        layer: 'unapproved-layer',
        format: sourcePolicy.roles[role].contract.format,
      }),
    ).toThrow(/layer/i);
  });

  it.each(roles)('rejects a non-template path for the %s role', (role) => {
    const contract = sourcePolicy.roles[role].contract;
    expect(() =>
      assertApprovedSourceRequest(role, {
        url: policyUrl(role, '/not-an-approved/template/path'),
        layer: contract.layer,
        format: contract.format,
      }),
    ).toThrow(/template|path/i);
  });

  it('expands approved basemap tile coordinates using only the policy template', () => {
    const contract = sourcePolicy.roles.basemap.contract;
    const expectedPath = contract.path_template
      .replace('{z}', '7')
      .replace('{x}', '11')
      .replace('{y}', '13');

    expect(basemapTileUrl(7, 11, 13)).toBe(
      `${contract.scheme}://${contract.host}:${contract.port}${expectedPath}`,
    );
  });

  it('uses the exact policy attribution for an active basemap and both active sources', () => {
    const basemapAttribution = sourcePolicy.roles.basemap.contract.attribution;
    const imageryAttribution = sourcePolicy.roles.imagery.contract.attribution;

    expect(composeAttribution({ basemap: true, imagery: false })).toBe(
      basemapAttribution,
    );
    expect(composeAttribution({ basemap: true, imagery: true })).toBe(
      `${basemapAttribution} · ${imageryAttribution}`,
    );
  });

  it('has no dangling separator or imagery wording for basemap-only attribution', () => {
    const attribution = composeAttribution({ basemap: true, imagery: false });

    expect(attribution).not.toContain('·');
    expect(attribution).not.toContain(
      sourcePolicy.roles.imagery.contract.attribution,
    );
  });
});
