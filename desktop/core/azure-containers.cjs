const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { command, azureResourceGroup, publicURL } = require('./deployment-providers.cjs');

const PROVIDER = 'azure-containers';
const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw Error('Vælg et Azure-abonnement fra listen.');
  return value;
};
const appName = value => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(value) || value.includes('--')) throw Error('Vælg en gyldig Azure Container App.');
  return value;
};
const relative = value => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || path.posix.normalize(value) !== value || value.startsWith('/') || value.split('/').includes('..') || /[\x00-\x1f]/.test(value)) throw Error('Vælg en relativ mappe eller Dockerfile uden ..');
  return value;
};
function containerConfiguration(input) {
  if (input.mode !== 'container') throw Error('Azure Container Apps bygger en container fra en Dockerfile.');
  const dockerfile = relative(input.dockerfile || 'Dockerfile');
  if (dockerfile === '.' || dockerfile.startsWith('-')) throw Error('Angiv Dockerfile-navnet i byggemappen.');
  return { provider: PROVIDER, mode: 'container', subscription: uuid(input.subscription), group: azureResourceGroup(input.group), project: appName(input.project), directory: relative(input.directory || '.'), dockerfile, frontend: '.', api: '' };
}
function validateContainerArtifact(config, artifact) {
  const file = artifact.files.find(f => f.file === config.dockerfile);
  if (!file) throw Object.assign(Error('Den gemte byggemappe mangler Dockerfile. Få hjælp af AI’en til at gøre projektet klar, og gem derefter en version.'), { code: 'MISSING_CONTAINER_DOCKERFILE' });
  if (file.data.length > 256 * 1024 || !/^\s*FROM\s+\S+/im.test(file.data.toString('utf8'))) throw Error('Dockerfile skal indeholde en FROM-instruktion.');
  // ACR modtager præcis de gennemgåede Git-filer, aldrig arbejdsmapper eller nøglelagre.
  for (const f of artifact.files) if (relative(f.file) === '.' || f.file.startsWith('-')) throw Error('Byggemappen indeholder en ugyldig filsti.');
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const resourceID = config => `/subscriptions/${uuid(config.subscription)}/resourceGroups/${azureResourceGroup(config.group)}/providers/Microsoft.App/containerApps/${appName(config.project)}`;
const sameID = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const hostURL = value => {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.azurecontainerapps\.io$/i.test(value)) throw Error('Azure gav en ukendt containeradresse.');
  return publicURL(value, '.azurecontainerapps.io');
};

class AzureContainerDeployment {
  constructor(run = command) { this.run = run; this.id = PROVIDER; }
  args(c) { return ['--name', appName(c.project), '--resource-group=' + azureResourceGroup(c.group), '--subscription', uuid(c.subscription)]; }
  async az(args, options) {
    const result = await this.run(process.env.HARNESS_AZ_PATH || 'az', [...args, '--only-show-errors', '--output', 'json'], options);
    try { return JSON.parse(result); } catch { throw Error('Azure gav et svar, der ikke kunne læses.'); }
  }
  async app(c) {
    const app = await this.az(['containerapp', 'show', ...this.args(c)]);
    if (!sameID(app.id, resourceID(c)) || app.name !== c.project) throw Error('Containerappen matcher ikke den valgte destination.');
    return app;
  }
  async inspect(c) {
    const app = await this.app(c), p = app.properties;
    if (p?.configuration?.activeRevisionsMode !== 'Single' || p.template?.containers?.length !== 1 || p.template?.initContainers?.length) throw Error('Vælg en særskilt Container App med én container og Single revision-tilstand.');
    const ingress = p.configuration.ingress;
    if (!ingress?.external || !ingress.fqdn || !Number.isInteger(ingress.targetPort) || !['auto', 'http', 'http2'].includes(String(ingress.transport).toLowerCase())) throw Error('Containerappen skal allerede have ekstern HTTP-adgang og en målport. Aura ændrer ikke adgangsregler eller porte.');
    const url = hostURL(ingress.fqdn);
    const registries = p.configuration.registries;
    if (!Array.isArray(registries) || registries.length !== 1 || !/^[a-z0-9]{5,50}\.azurecr\.io$/i.test(registries[0].server || '') || !registries[0].identity || registries[0].passwordSecretRef) throw Error('Forbind én Azure Container Registry med managed identity til appen i Azure først. Aura opretter ikke adgang eller henter registry-adgangskoder.');
    const entry = registries[0], registryName = entry.server.split('.')[0];
    const identity = entry.identity;
    if (identity === 'system' ? !app.identity?.type?.includes('SystemAssigned') || !app.identity?.principalId : !Object.keys(app.identity?.userAssignedIdentities || {}).some(id => sameID(id, identity))) throw Error('Appens managed identity matcher ikke dens registry-opsætning.');
    const registry = await this.az(['acr', 'show', '--name', registryName, '--subscription', uuid(c.subscription)]);
    const prefix = `/subscriptions/${c.subscription}/resourceGroups/`;
    if (typeof registry.id !== 'string' || !registry.id.toLowerCase().startsWith(prefix.toLowerCase()) || !new RegExp(`/providers/Microsoft\\.ContainerRegistry/registries/${registryName}$`, 'i').test(registry.id) || registry.loginServer?.toLowerCase() !== entry.server.toLowerCase()) throw Error('Registry matcher ikke det valgte Azure-abonnement.');
    const container = p.template.containers[0];
    if (typeof container.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(container.name)) throw Error('Containerens navn kunne ikke læses.');
    return { id: app.id, name: app.name, host: new URL(url).hostname, owner: c.subscription, region: app.location || 'Ukendt',
      registry: { id: registry.id, name: registryName, server: entry.server.toLowerCase() }, container: container.name,
      settings: { mode: 'Single', targetPort: ingress.targetPort, fingerprint: fingerprint({ configuration: p.configuration, template: p.template, identity: app.identity, environmentId: p.environmentId || p.managedEnvironmentId }) },
      access: 'Erstatter appens aktive version på dens eksisterende adresse. Adgangsregler, skalering og miljøvariabler bevares.',
      environmentKeys: (container.env || []).map(e => e.name).filter(n => typeof n === 'string').sort(),
      environmentNote: 'Den nye kode får appens eksisterende miljøværdier og runtime-adgang. Registry bygges med dit Azure CLI-login; ingen runtime-hemmeligheder sendes som build-argumenter.',
      materialNote: 'De gennemgåede filer fra den gemte Git-version sendes til Azure Container Registry, som bygger Dockerfile med netadgang. Kun den nye containerimage udgives til appen.',
      portal: 'https://portal.azure.com/#resource' + app.id };
  }
  async preparationPort(c) { return (await this.app(c)).properties?.configuration?.ingress?.targetPort; }
  async deploy(c, artifact, target, { onUploaded = async () => {}, onProgress = () => {} } = {}) {
    validateContainerArtifact(c, artifact);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-container-'));
    let updating = false;
    try {
      for (const file of artifact.files) {
        const destination = path.join(temp, relative(file.file));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, file.data, { flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644 });
      }
      const id = 'aura' + randomUUID().replace(/-/g, '').slice(0, 16);
      const tag = `aura/${appName(c.project)}:${artifact.head.slice(0, 12)}-${artifact.hash.slice(0, 12)}-${id}`;
      onProgress('build');
      const build = await this.az(['acr', 'build', '--registry', target.registry.name, '--subscription', uuid(c.subscription), '--image', tag, '--file', c.dockerfile, '--platform', 'linux/amd64', '--no-logs', temp], { cwd: temp, timeout: 600000 });
      if (build.status !== 'Succeeded' || typeof build.runId !== 'string' || !/^[a-z0-9]+$/i.test(build.runId)) throw Error('Containerbygningen lykkedes ikke. Den aktive app er ikke ændret.');
      const imageInfo = await this.az(['acr', 'repository', 'show', '--name', target.registry.name, '--subscription', uuid(c.subscription), '--image', tag]);
      if (!/^sha256:[a-f0-9]{64}$/.test(imageInfo.digest || '')) throw Error('Azure gav ikke et verificerbart containerimage.');
      const image = `${target.registry.server}/aura/${c.project}@${imageInfo.digest}`;
      // Bygningen kan tage tid. Kontrollér destinationen igen før den ændres.
      if (fingerprint(await this.inspect(c)) !== fingerprint(target)) throw Error('Destinationen er ændret under bygningen. Gennemgå den igen.');
      const result = { id, image, buildId: build.runId, state: 'SUBMITTING', url: null };
      await onUploaded(result);
      onProgress('activate');
      updating = true;
      await this.az(['containerapp', 'update', ...this.args(c), '--container-name', target.container, '--image', image, '--revision-suffix', id], { timeout: 180000 });
      return { ...result, state: 'UPLOADED' };
    } catch (error) {
      if (!updating) throw Object.assign(Error('Containeren kunne ikke bygges eller destinationen har ændret sig. Den aktive app er ikke opdateret; kontrollér Azure og gennemgå udgivelsen igen.'), { notUploaded: true });
      throw error;
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  }
  async status(c, receipt) {
    if (!/^aura[a-f0-9]{16}$/.test(receipt.id || '') || !/^.+@sha256:[a-f0-9]{64}$/.test(receipt.image || '') || !sameID(receipt.target?.id, resourceID(c))) throw Error('Udgivelsens containerkvittering er ugyldig.');
    const app = await this.app(c), name = `${c.project}--${receipt.id}`;
    const revision = await this.az(['containerapp', 'revision', 'show', ...this.args(c), '--revision', name]);
    if (revision.name !== name || !sameID(revision.id, `${app.id}/revisions/${name}`) || revision.properties?.template?.containers?.length !== 1 || revision.properties.template.containers[0].image !== receipt.image) throw Error('Azure-revisionen matcher ikke den godkendte container.');
    const ingress = app.properties.configuration?.ingress;
    if (!ingress?.external || new URL(hostURL(ingress.fqdn)).hostname !== receipt.target.host) throw Error('Appens adresse eller adgang har ændret sig.');
    const p = revision.properties;
    if (p.provisioningState === 'Failed' || p.healthState === 'Unhealthy') return { state: 'ERROR', url: null };
    if (app.properties.latestRevisionName !== name) return { state: 'REPLACED', url: null };
    const ready = app.properties.latestReadyRevisionName === name && p.active === true && p.provisioningState === 'Provisioned' && p.healthState === 'Healthy';
    return { state: ready ? 'READY' : 'AWAITING_UPDATE', url: ready ? hostURL(ingress.fqdn) : null };
  }
}
module.exports = { AzureContainerDeployment, containerConfiguration, validateContainerArtifact, hostURL, PROVIDER };
