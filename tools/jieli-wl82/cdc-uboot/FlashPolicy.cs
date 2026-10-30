// SPDX-License-Identifier: MIT
// Independent privileged V15 validator. Pure bytes only, no device/path APIs.
using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

public sealed class FlashPlan {
    public byte[] Candidate;
    public string BaselineSha256, CandidateSha256, ApplicationSha256, TargetBuildSha256;
    public int[] Sectors;
    public bool NoChanges { get { return Sectors.Length == 0; } }
}

public static class FlashPolicy {
    public const int FlashBytes = 0x100000, AppStart = 0x4120, AppEnd = 0x920dc;
    public const int AppCapacity = AppEnd - AppStart, SectorBytes = 4096, PageBytes = 256;
    const int Area = 0x4000, AreaBytes = 582235, ConfigBytes = 383;
    sealed class Decoded { public byte[] Raw, Plain; public int Key, Length; }
    sealed class Entry { public string Name; public uint Offset, Size; public int Flags, Reserved, Index; }
    static void Need(bool ok, string message) { if (!ok) throw new InvalidOperationException(message); }
    static ushort U16(byte[] b, int at) { return (ushort)(b[at] | (b[at+1] << 8)); }
    static uint U32(byte[] b, int at) { return (uint)(b[at] | (b[at+1] << 8) | (b[at+2] << 16) | (b[at+3] << 24)); }
    static void Put16(byte[] b, int at, int n) { b[at]=(byte)n; b[at+1]=(byte)(n>>8); }
    static void Put32(byte[] b, int at, int n) { for(int i=0;i<4;i++)b[at+i]=(byte)(n>>(i*8)); }
    static byte[] Slice(byte[] b, int at, int count) { byte[] r=new byte[count]; Buffer.BlockCopy(b,at,r,0,count); return r; }
    static bool Equal(byte[] a, byte[] b) { if(a.Length!=b.Length)return false; for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false; return true; }
    public static string Sha(byte[] b) { using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(b)).Replace("-","").ToLowerInvariant(); }
    static int Crc(byte[] b, int at, int length) { int value=0; for(int i=at;i<at+length;i++){value^=b[i]<<8;for(int j=0;j<8;j++)value=((value<<1)^((value&0x8000)!=0?0x1021:0))&65535;}return value; }
    static byte[] Crypt(byte[] b, int key) { byte[] r=(byte[])b.Clone(); for(int i=0;i<r.Length;i++){r[i]^=(byte)key;key=((key<<1)^((key&0x8000)!=0?0x1021:0))&65535;}return r; }
    static Entry ReadEntry(byte[] b, int at) {
        Need(U16(b,at)==Crc(b,at+2,30),"Directory CRC mismatch.");
        int end=0; while(end<16 && b[at+16+end]!=0){Need(b[at+16+end]>=32 && b[at+16+end]<=126,"Directory name invalid.");end++;}
        Need(end>0 && end<16,"Directory name invalid.");
        return new Entry { Name=Encoding.ASCII.GetString(b,at+16,end),Offset=U32(b,at+4),Size=U32(b,at+8),Flags=b[at+12],Reserved=b[at+13],Index=U16(b,at+14) };
    }
    static void Shape(Entry e,string name,uint offset,uint size,int flags,int reserved,int index) {
        Need(e.Name==name && e.Offset==offset && e.Size==size && e.Flags==flags && e.Reserved==reserved && e.Index==index,"V15 directory layout differs.");
    }
    static Decoded Decode(byte[] input) {
        Need(input!=null && input.Length==FlashBytes,"Exact 1 MiB baseline required.");
        byte[] raw=(byte[])input.Clone(), head=Crypt(Slice(raw,0,32),65535);
        Need(U16(head,0)!=0 && U16(head,0)==Crc(head,2,30),"Flash header CRC mismatch.");
        Entry[] top=new Entry[4]; for(int i=0;i<4;i++)top[i]=ReadEntry(Crypt(Slice(raw,32+i*32,32),65535),0);
        Shape(top[0],"uboot.boot",160,14384,0,0,0);
        Shape(top[1],"isd_config.ini",14544,699,2,128,0);
        Shape(top[2],"app_dir_head",Area,0xffffffff,129,255,0);
        Shape(top[3],"key_mac",0xff000,4096,18,1,65535);
        byte[] config=Slice(raw,(int)top[1].Offset,32);
        Need(Crc(config,0,32)==U16(raw,(int)top[1].Offset+32),"Encoding metadata CRC mismatch.");
        int threshold=0; for(int i=0;i<16;i++)threshold+=config[i];threshold&=255;
        if(threshold>=224)threshold=170;else if(threshold<=16)threshold=85;
        int key=0;for(int i=0;i<16;i++)if((config[16+i]^config[15-i])<threshold)key|=1<<i;
        byte[] plain=(byte[])raw.Clone();
        for(int at=Area;at<((Area+AreaBytes+31)/32)*32;at+=32)Buffer.BlockCopy(Crypt(Slice(raw,at,32),key^((at-Area)>>2)),0,plain,at,32);
        Shape(ReadEntry(plain,Area),"app_area_head",0x2000120,AreaBytes,131,255,0);
        Entry app=ReadEntry(plain,Area+32);
        Need(app.Name=="app.bin" && app.Offset==0x120 && app.Size>0 && app.Size<=AppCapacity && app.Flags==130 && app.Reserved==255 && app.Index==0,"V15 application layout differs.");
        Shape(ReadEntry(plain,Area+64),"cfg_tool.bin",AppEnd-Area,ConfigBytes,130,255,0);
        Shape(ReadEntry(plain,Area+96),"VM",0x93000,352256,18,128,0);
        Shape(ReadEntry(plain,Area+128),"PRCT",0,602112,146,130,0);
        Shape(ReadEntry(plain,Area+160),"BTIF",0xe9000,4096,146,128,0);
        Shape(ReadEntry(plain,Area+192),"USR",0xea000,73728,146,129,1);
        Need(U16(plain,Area+2)==Crc(plain,Area+32,AreaBytes-32),"V15 area CRC mismatch.");
        Need(U16(plain,Area+34)==Crc(plain,AppStart,(int)app.Size),"Application CRC mismatch.");
        Need(U16(plain,Area+66)==Crc(plain,AppEnd,ConfigBytes),"Configuration CRC mismatch.");
        return new Decoded {Raw=raw,Plain=plain,Key=key,Length=(int)app.Size};
    }
    static byte[] Application(byte[] input,string build) {
        Need(input!=null && input.Length>0 && input.Length<=AppCapacity,"Application length invalid.");
        Need(build!=null && build.Length==64,"Target build identity invalid.");byte[] id=new byte[32];bool nonzero=false;
        for(int i=0;i<64;i++){char c=build[i];Need((c>='0'&&c<='9')||(c>='a'&&c<='f'),"Target build identity invalid.");int n=c<='9'?c-'0':c-'a'+10;id[i/2]|=(byte)(n<<(i%2==0?4:0));if(n!=0)nonzero=true;}
        Need(nonzero,"Target build identity invalid.");bool found=false;
        for(int at=0;at+id.Length<=input.Length && !found;at++){found=true;for(int i=0;i<id.Length;i++)if(input[at+i]!=id[i]){found=false;break;}}
        Need(found,"Application lacks its target build identity.");return (byte[])input.Clone();
    }
    static byte[] Build(Decoded data,byte[] app) {
        byte[] plain=data.Plain,candidate=(byte[])data.Raw.Clone();Buffer.BlockCopy(app,0,plain,AppStart,app.Length);
        Put16(plain,Area+34,Crc(app,0,app.Length));Put32(plain,Area+40,app.Length);
        Put16(plain,Area+32,Crc(plain,Area+34,30));Put16(plain,Area+2,Crc(plain,Area+32,AreaBytes-32));Put16(plain,Area,Crc(plain,Area+2,30));
        for(int at=Area;at<Area+64;at+=32)Buffer.BlockCopy(Crypt(Slice(plain,at,32),data.Key^((at-Area)>>2)),0,candidate,at,32);
        for(int at=AppStart;at<((AppStart+app.Length+31)/32)*32;at+=32)Buffer.BlockCopy(Crypt(Slice(plain,at,32),data.Key^((at-Area)>>2)),0,candidate,at,32);
        return candidate;
    }
    public static bool ValidateCandidate(byte[] baseline,byte[] candidate,byte[] application,string targetBuild) {
        byte[] app=Application(application,targetBuild),expected=Build(Decode(baseline),app);
        Need(candidate!=null && Equal(candidate,expected),"Candidate differs from the exact baseline-derived application replacement.");
        Decoded after=Decode(candidate);Need(after.Length==app.Length && Equal(Slice(after.Plain,AppStart,app.Length),app),"Application round-trip mismatch.");return true;
    }
    public static FlashPlan Plan(byte[] baseline,byte[] application,string targetBuild) {
        byte[] app=Application(application,targetBuild);Decoded data=Decode(baseline);byte[] candidate=Build(data,app);
        ValidateCandidate(baseline,candidate,app,targetBuild);List<int> sectors=new List<int>();
        for(int at=Area+SectorBytes;at<0x93000;at+=SectorBytes)if(!Equal(Slice(data.Raw,at,SectorBytes),Slice(candidate,at,SectorBytes)))sectors.Add(at);
        if(!Equal(Slice(data.Raw,Area,SectorBytes),Slice(candidate,Area,SectorBytes)))sectors.Add(Area);
        return new FlashPlan {Candidate=candidate,BaselineSha256=Sha(data.Raw),CandidateSha256=Sha(candidate),ApplicationSha256=Sha(app),TargetBuildSha256=targetBuild,Sectors=sectors.ToArray()};
    }
}
