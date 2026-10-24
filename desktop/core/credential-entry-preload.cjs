const { contextBridge, ipcRenderer } = require('electron');
const channel=process.argv.find(value=>value.startsWith('--aura-secret-channel='))?.slice('--aura-secret-channel='.length);
if(!/^aura-secret-[a-f0-9]{32}$/.test(channel||''))throw new Error('Nøglevinduet mangler sin lokale kanal.');
contextBridge.exposeInMainWorld('auraKeyEntry',Object.freeze({context:()=>ipcRenderer.invoke(channel,{action:'context'}),submit:value=>ipcRenderer.invoke(channel,{action:'submit',value}),cancel:()=>ipcRenderer.invoke(channel,{action:'cancel'})}));
