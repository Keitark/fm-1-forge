import { App, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { OpenAIFileEntrypointInputSchema } from '@openai/mcp-extensions';
import { createResourceEditor, parseForgeRoute, validateLocalPath } from './fm1-extension-host.mjs';
import { browserHardwareCapabilities } from './fm1-browser-hardware.mjs';
import './fm1-browser-devices-ui.mjs';
import './fm1-browser-library.mjs';

// These official SDKs are bundled locally into the MCP App resource.
export class FM1PluginHost {
  constructor({onToolResult=()=>{},onToolInput=()=>{},onTeardown=()=>{},onContext=()=>{}}={}) {
    this.app=new App({name:'FM1 Forge',version:'3.2.0'},
      {availableDisplayModes:['inline','fullscreen']},{autoResize:false});
    this.extensions=new OpenAIExtensions(this.app);
    this.closed=false;this.transportClosed=false;this.resources=new Set();
    this.app.addEventListener('toolresult',onToolResult);
    this.app.addEventListener('toolinput',event=>{const parsed=OpenAIFileEntrypointInputSchema.safeParse(event.arguments);if(parsed.success)onToolInput(parsed.data);});
    this.app.addEventListener('hostcontextchanged',()=>{this.applyStyles();onContext(this.context());});
    this.app.onteardown=async()=>{this.closed=true;this.releaseResources();onTeardown();return {};};
  }
  context(){return this.app.getHostContext()||{};}
  browserHardware(){return browserHardwareCapabilities();}
  applyStyles(){const values=this.context().styles?.variables;if(values&&typeof document!=='undefined')applyHostStyleVariables(Object.fromEntries(Object.entries(values).filter(([key])=>/^--(?:color|font|border|spacing|shadow)-/.test(key))));}
  features(){return {message:!!this.extensions.message,coreMessage:!!this.app.getHostCapabilities()?.message?.text,
    modelContext:!!this.extensions.modelContext,files:!!this.extensions.files,resources:!!this.extensions.resources,
    displayModes:this.context().availableDisplayModes||[]};}
  state(){return {route:parseForgeRoute(this.extensions.deepLink.getCurrent()?.url),modelContext:this.extensions.modelContext?.getCurrent(),features:this.features()};}
  async connect(){await this.app.connect();this.applyStyles();return {capabilities:this.app.getHostCapabilities()||{},context:this.context(),extensions:this.state()};}
  call(name,args,signal){if(this.closed)throw new Error('This panel was closed.');return this.app.callServerTool({name,arguments:args},{signal,timeout:15000});}
  async message(text,signal,{target='active',send=true}={}){
    if(this.closed)throw new Error('This panel was closed.');
    if(!['active','new'].includes(target)||typeof send!=='boolean')throw new Error('Choose a supported conversation action.');
    const params={role:'user',content:[{type:'text',text}],_meta:{'openai/message':{target,send}}};
    let result;
    if(this.extensions.message)result=await this.extensions.message.send(params,{signal,timeout:15000});
    else if(target==='active'&&send&&this.app.getHostCapabilities()?.message?.text)result=await this.app.sendMessage({role:'user',content:params.content},{signal,timeout:15000});
    else throw new Error('This host does not support this conversation action. Copy the project prompt into Codex.');
    if(result.isError)throw new Error('The host rejected the project request. Copy the prompt into Codex.');return result;
  }
  async modelContext(params,signal){if(this.closed||!this.extensions.modelContext)throw new Error('This host does not support project context.');return this.extensions.modelContext.update(params,{signal,timeout:15000});}
  async openFile(path){if(this.closed||!this.extensions.files)throw new Error('This host does not support its native file viewer.');return this.extensions.files.open(validateLocalPath(path));}
  async displayMode(mode){if(this.closed||!['inline','fullscreen'].includes(mode))throw new Error('Choose inline or fullscreen.');return this.app.requestDisplayMode({mode});}
  fileInput(input){return OpenAIFileEntrypointInputSchema.parse(input);}
  resourceEditor(callback){if(this.closed||!this.extensions.resources)throw new Error('This host does not support resource viewing and editing.');const editor=createResourceEditor(this.extensions.resources,callback);this.resources.add(editor);return editor;}
  releaseResources(){for(const editor of this.resources)editor.close();this.resources.clear();}
  close(){this.closed=true;this.releaseResources();if(this.transportClosed)return;this.transportClosed=true;void this.app.close();}
}
if(typeof window!=='undefined')window.FM1PluginHost=FM1PluginHost;
