import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage, shell } from 'electron';
import type { WorkspaceStore } from './workspace.js';

const scope='https://www.googleapis.com/auth/drive.readonly';
type Tokens={access_token:string;refresh_token?:string;expires_at:number};
export class GoogleDrive {
  private busy=false;
  constructor(private read:()=>any,private write:(settings:any)=>void){}
  private decrypt(value:string){if(!safeStorage.isEncryptionAvailable())throw new Error('Operating-system encryption is unavailable.');return safeStorage.decryptString(Buffer.from(value,'base64'));}
  private save(key:string,value:unknown){if(!safeStorage.isEncryptionAvailable())throw new Error('Operating-system encryption is unavailable.');const settings=this.read();settings[key]=safeStorage.encryptString(JSON.stringify(value)).toString('base64');this.write(settings);}
  isBusy(){return this.busy;}
  status(){const settings=this.read();return {configured:Boolean(settings.driveClient),connected:Boolean(settings.driveTokens)};}
  configure(file:string){if(this.busy)throw new Error('Wait for the Google Drive operation to finish.');const client=JSON.parse(fs.readFileSync(file,'utf8')).installed;if(!client?.client_id||!client?.client_secret)throw new Error('Choose the JSON downloaded for a Google OAuth Desktop app client.');this.save('driveClient',{client_id:client.client_id,client_secret:client.client_secret});const settings=this.read();delete settings.driveTokens;this.write(settings);return this.status();}
  private async token(params:Record<string,string>){const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Google authorization failed. Reconnect Google Drive and check your OAuth configuration.');const value=await response.json() as any;return {...value,expires_at:Date.now()+value.expires_in*1000} as Tokens;}
  async connect(){
    if(this.busy)throw new Error('A Google Drive operation is already running.');
    this.busy=true;
    try{
      const settings=this.read();if(!settings.driveClient)throw new Error('Load your Google desktop OAuth client JSON first.');
      const client=JSON.parse(this.decrypt(settings.driveClient));
      const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(32).toString('base64url');
      let redirect='';
      let resolveCode!:(value:string)=>void,rejectCode!:(error:Error)=>void;
      const codePromise=new Promise<string>((resolve,reject)=>{resolveCode=resolve;rejectCode=reject;});
      // Attach a handler immediately while the system browser opens.
      void codePromise.catch(()=>{});
      const server=http.createServer((request,response)=>{
        const url=new URL(request.url||'/',redirect);
        if(url.pathname!=='/callback'){response.writeHead(404).end();return;}
        if(url.searchParams.get('state')!==state){response.writeHead(400).end('Invalid authorization state.');return;}
        const code=url.searchParams.get('code');
        response.setHeader('Content-Type','text/plain');response.end(code?'Connected. Return to Research Desk.':'Authorization cancelled. Return to Research Desk.');
        if(code)resolveCode(code);else rejectCode(new Error('Google sign-in was cancelled.'));
      });
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
        const address=server.address();if(!address||typeof address==='string')throw new Error('Could not start sign-in callback.');
        redirect=`http://127.0.0.1:${address.port}/callback`;
        timer=setTimeout(()=>rejectCode(new Error('Google sign-in timed out. Try again.')),180000);
        const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',scope,access_type:'offline',prompt:'consent',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
        await shell.openExternal(url.toString());
        const code=await codePromise;
        this.save('driveTokens',await this.token({...client,code,redirect_uri:redirect,grant_type:'authorization_code',code_verifier:verifier}));
      }finally{if(timer)clearTimeout(timer);server.close();server.closeAllConnections();}
      return this.status();
    }finally{this.busy=false;}
  }
  private async accessToken(){const settings=this.read();if(!settings.driveTokens)throw new Error('Connect Google Drive first.');let tokens=JSON.parse(this.decrypt(settings.driveTokens)) as Tokens;if(tokens.expires_at<Date.now()+60000){if(!tokens.refresh_token)throw new Error('Reconnect Google Drive to renew access.');const client=JSON.parse(this.decrypt(settings.driveClient));tokens={...tokens,...await this.token({...client,refresh_token:tokens.refresh_token,grant_type:'refresh_token'})};this.save('driveTokens',tokens);}return tokens.access_token;}
  async disconnect(){if(this.busy)throw new Error('Wait for the Google Drive operation to finish.');const settings=this.read();if(settings.driveTokens){const tokens=JSON.parse(this.decrypt(settings.driveTokens)) as Tokens;const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token:tokens.refresh_token||tokens.access_token}),signal:AbortSignal.timeout(30000)});if(!response.ok&&response.status!==400)throw new Error('Google could not revoke access. Try disconnecting again.');}delete settings.driveTokens;this.write(settings);return this.status();}
  async importAll(store:WorkspaceStore){
    if(this.busy)throw new Error('A Google Drive operation is already running.');
    if(!store.info)throw new Error('Open a workspace first.');
    this.busy=true;const workspaceId=store.info.id;
    let imported=0,skipped=0;const errors:string[]=[];let pageToken='';
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'research-desk-drive-'));
    const request=async(url:string)=>{const response=await fetch(url,{headers:{Authorization:`Bearer ${await this.accessToken()}`},signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`Google Drive request failed (${response.status}). Check access and reconnect if needed.`);return response;};
    const sameWorkspace=()=>{if(store.info?.id!==workspaceId)throw new Error('The workspace changed. Import stopped; completed files were saved.');};
    try{
      do{
        sameWorkspace();
        const url=new URL('https://www.googleapis.com/drive/v3/files');url.search=new URLSearchParams({q:"trashed = false and mimeType != 'application/vnd.google-apps.folder'",spaces:'drive',pageSize:'100',fields:'nextPageToken,files(id,name,mimeType)',pageToken,includeItemsFromAllDrives:'true',supportsAllDrives:'true'}).toString();
        const page=await (await request(url.toString())).json() as {nextPageToken?:string;files:Array<{id:string;name:string;mimeType:string}>};
        for(const file of page.files){
          sameWorkspace();if(store.hasDriveImport(file.id)){skipped++;continue;}
          const exports:Record<string,[string,string]>={'application/vnd.google-apps.document':['application/vnd.openxmlformats-officedocument.wordprocessingml.document','.docx'],'application/vnd.google-apps.presentation':['application/pdf','.pdf'],'application/vnd.google-apps.spreadsheet':['application/pdf','.pdf']};
          const format=exports[file.mimeType];
          if(!format&&!/\.(pdf|docx|md|txt|png|jpg|jpeg|gif|webp)$/i.test(file.name)){skipped++;continue;}
          try{
            const endpoint=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`+(format?`/export?mimeType=${encodeURIComponent(format[0])}`:'?alt=media&supportsAllDrives=true');
            const bytes=Buffer.from(await (await request(endpoint)).arrayBuffer());sameWorkspace();
            const name=(file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,150)||'Untitled')+(format?format[1]:'');
            const folder=path.join(temp,crypto.randomUUID());fs.mkdirSync(folder);const target=path.join(folder,name);fs.writeFileSync(target,bytes);
            const result=await store.importFiles([target],'copy');sameWorkspace();
            const itemId=result.imported[0]?.id||result.duplicates[0]?.existingId;if(itemId)store.recordDriveImport(file.id,itemId);
            imported+=result.imported.length;skipped+=result.duplicates.length;
          }catch(error){sameWorkspace();errors.push(`${file.name}: ${error instanceof Error?error.message:String(error)}`);}
        }
        pageToken=page.nextPageToken||'';
      }while(pageToken);
      return {imported,skipped,errors};
    }finally{fs.rmSync(temp,{recursive:true,force:true});this.busy=false;}
  }
}
