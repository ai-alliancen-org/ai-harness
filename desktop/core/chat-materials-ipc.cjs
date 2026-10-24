// SPDX-License-Identifier: EUPL-1.2
// Native dialogs are the only source of paths. A renderer may submit opaque IDs.
const { ChatMaterials, EXTENSIONS } = require('./chat-materials.cjs');
const METHODS = Object.freeze({ chatMaterialsState:'chat-materials:state', chatMaterialsChooseFiles:'chat-materials:choose-files', chatMaterialsPreview:'chat-materials:preview', chatMaterialsAttach:'chat-materials:attach', chatMaterialsRemove:'chat-materials:remove' });
function installChatMaterials({ getWorkbench, isSelected = () => true, register, dialog, exclusive, normalizeImage, emit = () => {} }) {
  function owner(value, fields = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['chat', ...fields].includes(key)) || typeof value.chat !== 'string') throw new Error('Brug filvalget i den aktuelle samtale. Der modtages ingen filstier.');
    const bench = getWorkbench(), chat = bench?.chatFor(value.chat);
    if (!chat || !bench.project || bench.chatID !== chat.id || bench.chats.get(chat.id) !== chat) throw new Error('Vælg den aktuelle samtale først.');
    bench.chatMaterials ||= new ChatMaterials({ normalizeImage, onChange:event => emit({ ...event, root:bench.project.root }) });
    return { bench, chat, materials:bench.chatMaterials, root:bench.project.root };
  }
  function current(owner) {
    if (!isSelected(owner.bench) || getWorkbench() !== owner.bench || owner.bench.project?.root !== owner.root || owner.bench.chatID !== owner.chat.id || owner.bench.chats.get(owner.chat.id) !== owner.chat) throw new Error('Samtalen er skiftet. Det tidligere filvalg er ikke anvendt.');
    if (owner.chat.running || owner.chat.starting || owner.chat.sending || owner.chat.finishing || owner.bench.busyRoot(owner.chat.root)) throw new Error('Vent på opgaven, før du ændrer vedhæftninger.');
  }
  const handle = (name, action) => register(METHODS[name], action);
  handle('chatMaterialsState', value => { const o = owner(value); return o.materials.state(o.chat); });
  handle('chatMaterialsChooseFiles', value => exclusive(async () => {
    const o = owner(value); current(o);
    const result = await dialog.showOpenDialog({ title:'Vælg filer eller screenshots til denne samtale', properties:['openFile','multiSelections','dontAddToRecent'], filters:[{ name:'Tekst 128 KB · PNG/JPEG 5 MB', extensions:[...EXTENSIONS] }] });
    current(o);
    if (result.canceled || !result.filePaths?.length) return { ...o.materials.state(o.chat), cancelled:true };
    const selected = await o.materials.offerFiles(o.chat, result.filePaths); current(o); return selected;
  }));
  for (const [method, fields, action] of [
    ['chatMaterialsPreview',['scope','revision','ids'],'preview'],
    ['chatMaterialsAttach',['scope','revision','token'],'attach'],
    ['chatMaterialsRemove',['scope','revision','id'],'remove']
  ]) handle(method, value => exclusive(async () => { const o = owner(value, fields); current(o); const result = await o.materials[action](o.chat, value); current(o); return result; }));
}
module.exports = { METHODS, installChatMaterials };
