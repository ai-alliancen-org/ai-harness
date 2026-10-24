const { contextBridge, ipcRenderer } = require('electron');
const methods = {
  chatMaterialsState:'chat-materials:state', chatMaterialsChooseFolder:'chat-materials:choose-folder', chatMaterialsChooseFiles:'chat-materials:choose-files', chatMaterialsPreview:'chat-materials:preview', chatMaterialsAttach:'chat-materials:attach', chatMaterialsRemove:'chat-materials:remove',
  deploymentCancelSetup: 'deployment:setup-cancel',
  projectSettings: 'project:settings', saveProjectSettings: 'project:settings-save', chatArchive: 'chat:archive',
  updatesState: 'updates:state', updatesCheck: 'updates:check', updatesDownload: 'updates:download', updatesRestart: 'updates:restart', updatesAutomatic: 'updates:automatic', updatesWebsite: 'updates:website', updatesNotes: 'updates:notes',
  chatMergeReview: 'chat:merge-review', chatMerge: 'chat:merge',
  supportReport: 'support:report', supportSave: 'support:save', supportFeedback: 'support:feedback', supportContact: 'support:contact',
  restoreReview: 'git:restore-review', restoreVersion: 'git:restore', historyVersion: 'history:version', historyRename: 'history:rename', historyImage: 'history:image',
  promtePreviewConnect: 'promte:preview-connect', promtePreviewLogin: 'promte:preview-login', promtePreviewCreate: 'promte:preview-create', promtePreviewFetch: 'promte:preview-fetch', komplaiPreviewState: 'komplai:preview-state', komplaiPreviewCreate: 'komplai:preview-create', komplaiPreviewCall: 'komplai:preview-call',
  previewRuntime: 'preview:runtime', previewCheck: 'preview:check', previewPick: 'preview:pick', previewEditText: 'preview:edit-text', previewContains: 'preview:contains', changesUndo: 'changes:undo', previewPrepare: 'preview:prepare', previewExecute: 'preview:execute', previewStop: 'preview:stop',
  newConversation: 'workspace:new-conversation', chatOpen: 'chat:open', chatRename: 'chat:rename', chatDelete: 'chat:delete', projectLocation: 'project:location', chooseProjectLocation: 'project:choose-location', recentProjects: 'project:recent', reopenProject: 'project:reopen', saveDraft: 'workspace:draft',
  deploymentGuides: 'deployment:guides', deploymentGuideOpen: 'deployment:guide-open', deploymentState: 'deployment:state', deploymentSource: 'deployment:source', deploymentReview: 'deployment:review', deploymentSend: 'deployment:send', deploymentCheck: 'deployment:check', deploymentOpen: 'deployment:open', deploymentSetup: 'deployment:setup', deploymentSetupOpen: 'deployment:setup-open', deploymentTracking: 'deployment:tracking',
  preferencesGet: 'preferences:get', preferencesSave: 'preferences:save', clearAssets: 'designs:clear',
  hostingState: 'hosting:state', hostingToken: 'hosting:token', hostingLogin: 'hosting:login', hostingPoll: 'hosting:poll', hostingCancel: 'hosting:cancel', hostingBrowser: 'hosting:browser', hostingDisconnect: 'hosting:disconnect', hostingCatalog: 'hosting:catalog', hostingCreate: 'hosting:create', hostingAttach: 'hosting:attach', hostingReview: 'hosting:review', hostingPush: 'hosting:push', hostingOpen: 'hosting:open',
  discoverLocalModels: 'connections:discover', setupStatus: 'setup:status', providerAccount: 'connections:account',
  gitIdentity: 'git:identity', gitStatus: 'git:status', gitInit: 'git:init', gitReview: 'git:review', gitCommit: 'git:commit', gitSave: 'git:save', gitAutomatic: 'git:automatic',
  listDesigns: 'designs:list', saveDesign: 'designs:save', applyDesign: 'designs:apply',
  createProject: 'project:create', openProject: 'project:open', newProject: 'project:new', chooseAssets: 'assets:choose', removeAsset: 'assets:remove', revision: 'preview:revision', attachPreview: 'preview:attach',
  komplaiLogin: 'komplai:login', komplaiCancel: 'komplai:cancel', komplaiConnect: 'komplai:connect', komplaiPublishState: 'komplai:publish-state', komplaiPublishOverview: 'komplai:publish-overview', komplaiPublishAddress: 'komplai:publish-address', komplaiPublishDisconnect: 'komplai:publish-disconnect',
  connectionState: 'connections:state', saveConnection: 'connections:save', removeConnection: 'connections:remove', models: 'connections:models', routes: 'connections:routes',
  toolsCatalog: 'tools:catalog', toolsFolder: 'tools:folder', toolsReview: 'tools:review', toolsInstall: 'tools:install', toolsRemoval: 'tools:removal', toolsRemove: 'tools:remove', toolsReveal: 'tools:reveal',
  prepare: 'agent:prepare', send: 'agent:send', stop: 'agent:stop', reply: 'agent:reply', question: 'agent:question', briefSave: 'plan:brief', briefWishes: 'plan:wishes', planEdit: 'plan:edit', planRestore: 'plan:restore', changesOverview: 'changes:overview', changesFile: 'changes:file', codeList: 'code:list', codeRead: 'code:read', activityList: 'activity:list', skills: 'skills:list', saveSkill: 'skills:save', featuresGet: 'features:get', featuresSave: 'features:save'
};
let selection = null;
const api = Object.fromEntries(Object.entries(methods).map(([name, channel]) => [name, (value, owner = selection) => ipcRenderer.invoke(channel, value, owner)]));
api.selectContext = value => { selection = value && typeof value.root === 'string' ? { root: value.root, chat: typeof value.chat === 'string' ? value.chat : null } : null; };
api.onEvent = callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('harness:event', listener); return () => ipcRenderer.removeListener('harness:event', listener); };
contextBridge.exposeInMainWorld('harness', api);
