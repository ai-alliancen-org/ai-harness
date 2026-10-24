// SPDX-License-Identifier: EUPL-1.2
// Catalog declarations and measured outcomes are different kinds of evidence.
const { createHash } = require('node:crypto');
const version = require('./engine.cjs').VERSION;
const known = value => typeof value === 'boolean' ? value : null;
function binding(connection, model, route) {
 return { connection:connection.id, revision:connection.revision || null, endpoint:connection.baseURL, protocol:connection.protocol || require('./connections.cjs').definitions[connection.kind]?.protocol || connection.kind, model:model.id, route:route?.id || null, engine:version };
}
const key = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function report(connection, model, route, { catalogAt = null, evidence = [] } = {}) {
 const bound = binding(connection,model,route),fingerprint=key(bound);
 const measurements = evidence.filter(item => item && item.binding === fingerprint && ['tools','images'].includes(item.capability) && ['passed','failed'].includes(item.outcome) && ['controlled','provider'].includes(item.environment) && typeof item.method==='string' && item.method.length<=500 && typeof item.at==='string' && Number.isFinite(Date.parse(item.at))).map(item=>({capability:item.capability,outcome:item.outcome,environment:item.environment,method:item.method,at:item.at}));
 return {binding:bound,fingerprint,catalog:{source:'provider-catalog',checkedAt:catalogAt,model:{tools:known(model.capabilities?.tools),images:known(model.capabilities?.vision)},route:route?{tools:known(route.capabilities?.tools),images:known(route.capabilities?.vision)}:null},measurements,note:'Katalogoplysninger er ikke en faktisk acceptprøve. Kontrollerede testservere beviser ikke produktionsmodellens evner. Ukendt støtte er ikke dokumenteret støtte.'};
}
function imageAllowed(model, route) { return model.capabilities?.vision===true && (!route || route.capabilities?.vision===true); }
function toolRun(connection, model, route) {
 const url = new URL(connection.baseURL), controlled = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 return { binding:key(binding(connection,model,route)),capability:'tools',outcome:'passed',environment:controlled?'controlled':'provider',method:'En opgave indeholdt et afsluttet værktøj og et afsluttende modelsvar. Det er en observation af dette forløb, ikke en generel modelkvalifikation.',at:new Date().toISOString() };
}
module.exports={binding,key,report,imageAllowed,toolRun};
