const { command } = require('./deployment-providers.cjs');

const subscriptionID = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw Error('Vælg et Azure-abonnement fra listen.');
  return value;
};
const displayName = value => typeof value === 'string' && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value) ? value : '';
const { azureResourceGroup, azureAppName } = require('./deployment-providers.cjs');

function subscriptions(value) {
  if (!Array.isArray(value)) throw Error('Azure gav ikke en liste over abonnementer.');
  const seen = new Set();
  return value.flatMap(item => {
    try {
      const id = subscriptionID(item?.id);
      // De eksisterende udgivelsesadresser og loginforløbet gælder Azure Public Cloud.
      if (item.state !== 'Enabled' || item.environmentName && item.environmentName !== 'AzureCloud' || seen.has(id.toLowerCase())) return [];
      seen.add(id.toLowerCase());
      return [{ id, name: displayName(item.name) || id }];
    } catch { return []; }
  }).sort((a, b) => a.name.localeCompare(b.name, 'da') || a.id.localeCompare(b.id));
}

function apps(value, subscription) {
  if (!Array.isArray(value)) throw Error('Azure gav ikke en liste over apps.');
  const seen = new Set();
  return value.flatMap(item => {
    try {
      if (typeof item?.id !== 'string') return [];
      const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Web\/staticSites\/([^/]+)$/i.exec(item.id);
      if (!match || match[1].toLowerCase() !== subscription.toLowerCase()) return [];
      const group = azureResourceGroup(match[2]), name = azureAppName(match[3]);
      if (item.name !== name || seen.has(item.id.toLowerCase())) return [];
      if (typeof item.defaultHostname !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.azurestaticapps\.net$/i.test(item.defaultHostname)) return [];
      seen.add(item.id.toLowerCase());
      return [{ id: item.id, name, group, subscription, location: displayName(item.location), host: item.defaultHostname.toLowerCase() }];
    } catch { return []; }
  }).sort((a, b) => a.name.localeCompare(b.name, 'da') || a.group.localeCompare(b.group, 'da'));
}

function containerApps(value, subscription) {
  if (!Array.isArray(value)) throw Error('Azure gav ikke en liste over containerapps.');
  const seen = new Set();
  return value.flatMap(item => {
    const match = typeof item?.id === 'string' && /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.App\/containerApps\/([^/]+)$/i.exec(item.id);
    if (!match || match[1].toLowerCase() !== subscription.toLowerCase() || item.name !== match[3] || seen.has(item.id.toLowerCase())) return [];
    try {
      const group = azureResourceGroup(match[2]);
      const host = new URL(require('./azure-containers.cjs').hostURL(item.properties?.configuration?.ingress?.fqdn)).hostname;
      if (!item.properties.configuration.ingress.external) return [];
      seen.add(item.id.toLowerCase());
      return [{ id: item.id, name: item.name, group, subscription, location: displayName(item.location), host }];
    } catch { return []; }
  }).sort((a, b) => a.name.localeCompare(b.name, 'da') || a.group.localeCompare(b.group, 'da'));
}

class AzureSetup {
  constructor(run = command, { containers = false } = {}) { this.run = run; this.pending = null; this.containers = containers; }
  async az(args, options) {
    const text = await this.run(process.env.HARNESS_AZ_PATH || 'az', [...args, '--only-show-errors', '--output', 'json'], options);
    try { return JSON.parse(text); } catch { throw Error('Azure gav et svar, der ikke kunne læses. Prøv igen.'); }
  }
  async state() {
    const tool = this.containers ? 'containerAppsCli' : 'swaCli';
    const tools = { azureCli: false, [tool]: false };
    const found = await Promise.allSettled([
      this.az(['version']),
      this.containers ? this.run(process.env.HARNESS_AZ_PATH || 'az', ['containerapp', '--help']) : this.run(process.env.HARNESS_SWA_PATH || 'swa', ['--version'])
    ]);
    tools.azureCli = found[0].status === 'fulfilled';
    tools[tool] = found[1].status === 'fulfilled';
    if (!tools.azureCli) return { status: 'tools-required', tools, subscriptions: [] };
    let list;
    try { list = subscriptions(await this.az(['account', 'list', '--refresh'])); }
    catch { return { status: 'login-required', tools, subscriptions: [] }; }
    return { status: !tools[tool] ? 'tools-required' : list.length ? 'ready' : 'no-subscriptions', tools, subscriptions: list };
  }
  async login() {
    if (this.pending) throw Error('Azure-login er allerede i gang.');
    this.pending = this.az(['login'], {
      timeout: 180000,
      // Valget foretages i Aura. CLI-konfigurationen på computeren ændres ikke.
      extra: { AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off' }
    });
    try {
      await this.pending;
      return await this.state();
    } catch { throw Error('Login blev ikke afsluttet. Prøv igen, eller log ind med Azure CLI og vælg Kontrollér igen.'); }
    finally { this.pending = null; }
  }
  async apps(subscription) {
    subscriptionID(subscription);
    try {
      return (this.containers ? containerApps : apps)(await this.az([this.containers ? 'containerapp' : 'staticwebapp', 'list', '--subscription', subscription]), subscription);
    } catch { throw Error('Dine Azure-apps kunne ikke hentes. Kontrollér login og adgang til det valgte abonnement.'); }
  }
}

module.exports = { AzureSetup, subscriptions, apps, containerApps };
