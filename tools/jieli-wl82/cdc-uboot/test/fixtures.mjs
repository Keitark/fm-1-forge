import { crc16, FLASH_BYTES, APP_START, APP_END, APP_CAPACITY } from '../policy.mjs';
export const BUILD = '1234567890abcdef'.repeat(4);
const AREA=0x4000, AREA_BYTES=582235;
function put16(b,a,n){new DataView(b.buffer,b.byteOffset,b.byteLength).setUint16(a,n,true);}
function put32(b,a,n){new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(a,n,true);}
export function crypt(b,key){const r=Uint8Array.from(b);for(let i=0;i<r.length;i++){r[i]^=key&255;key=((key<<1)^(key&0x8000?0x1021:0))&65535;}return r;}
function header(name,offset,size,flags,reserved,index){const b=new Uint8Array(32).fill(255);put16(b,2,65535);put32(b,4,offset);put32(b,8,size);b[12]=flags;b[13]=reserved;put16(b,14,index);b.set(Buffer.from(name+'\0'),16);put16(b,0,crc16(b.subarray(2)));return b;}
export function app(length=4097,seed=11){const b=Uint8Array.from({length},(_,i)=>(i*13+seed)&255);b.set(Buffer.from(BUILD,'hex'),16);return b;}
// Synthetic metadata encodes a public test-only key; no unit bytes are used.
export function baseline(application=app()){
 const raw=Uint8Array.from({length:FLASH_BYTES},(_,i)=>(i*7+3)&255),plain=Uint8Array.from(raw),key=0x1234;
 const head=new Uint8Array(32);head[8]=1;put16(head,0,crc16(head.subarray(2)));raw.set(crypt(head,65535));
 [['uboot.boot',160,14384,0,0,0],['isd_config.ini',14544,699,2,128,0],['app_dir_head',AREA,0xffffffff,129,255,0],['key_mac',0xff000,4096,18,1,65535]].forEach((v,i)=>raw.set(crypt(header(...v),65535),32+i*32));
 const encoding=new Uint8Array(32);for(let i=0;i<16;i++)encoding[16+i]=key&(1<<i)?0:85;raw.set(encoding,14544);put16(raw,14576,crc16(encoding));
 [['app_area_head',0x2000120,AREA_BYTES,131,255,0],['app.bin',0x120,application.length,130,255,0],['cfg_tool.bin',APP_END-AREA,383,130,255,0],['VM',0x93000,352256,18,128,0],['PRCT',0,602112,146,130,0],['BTIF',0xe9000,4096,146,128,0],['USR',0xea000,73728,146,129,1]].forEach((v,i)=>plain.set(header(...v),AREA+i*32));
 plain.set(application,APP_START);put16(plain,AREA+34,crc16(application));put16(plain,AREA+32,crc16(plain.subarray(AREA+34,AREA+64)));
 put16(plain,AREA+66,crc16(plain.subarray(APP_END,APP_END+383)));put16(plain,AREA+64,crc16(plain.subarray(AREA+66,AREA+96)));
 put16(plain,AREA+2,crc16(plain.subarray(AREA+32,AREA+AREA_BYTES)));put16(plain,AREA,crc16(plain.subarray(AREA+2,AREA+32)));
 for(let at=AREA;at<Math.ceil((AREA+AREA_BYTES)/32)*32;at+=32)raw.set(crypt(plain.subarray(at,at+32),key^((at-AREA)>>>2)),at);
 return raw;
}
export { APP_START, APP_END, APP_CAPACITY };
