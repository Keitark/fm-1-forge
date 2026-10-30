// SPDX-License-Identifier: MIT
// WL82 command layout derived from jl-uboot-tool (see LICENSE.jl-uboot-tool).
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

public interface IFm1FlashProtocol : IDisposable {
    void LoadPinnedHelper(byte[] helper);
    int Status();
    byte[] ReadPage(int address);
    void EraseSector(int address);
    void ProgramPage(int address, byte[] page);
    void ResetVerified();
}

// This type has no public generic CDB or memory API. The path is selected only
// by the privileged worker's fixed PnP policy, never from an MCP request.
public sealed class Fm1ScsiProtocol : IFm1FlashProtocol {
    [StructLayout(LayoutKind.Sequential)] struct Sptd {
        public ushort Length; public byte Status, Path, Target, Lun, CdbLength, SenseLength, Direction;
        public uint DataLength, Timeout; public IntPtr Data; public uint SenseOffset;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst=16)] public byte[] Cdb;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string p,uint a,uint s,IntPtr sa,uint c,uint f,IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle h,uint code,ref Sptd input,uint il,ref Sptd output,uint ol,out uint returned,IntPtr overlap);
    readonly SafeFileHandle handle;
    bool loaded, reset;
    public Fm1ScsiProtocol(string path) {
        if (!System.Text.RegularExpressions.Regex.IsMatch(path, @"^\\\\\.\\PHYSICALDRIVE[0-9]{1,3}$")) throw new IOException("loader_path_invalid");
        handle=CreateFile(path,0xc0000000u,3,IntPtr.Zero,3,0,IntPtr.Zero);
        if(handle.IsInvalid) { handle.Dispose(); throw new IOException("loader_open_failed"); }
        try {
            byte[] r=Execute(new byte[]{0x12,0,0,0,36,0},new byte[36],true);
            if(Encoding.ASCII.GetString(r,8,8).Trim()!="WL82" || Encoding.ASCII.GetString(r,16,16).Trim()!="UBOOT1.00" || Encoding.ASCII.GetString(r,32,4).Trim()!="1.00") throw new IOException("loader_inquiry_mismatch");
        } catch {handle.Dispose();throw;}
    }
    byte[] Execute(byte[] cdb,byte[] data,bool input) {
        if(reset || handle.IsClosed || cdb.Length>16 || data.Length<1 || data.Length>512) throw new IOException("transport_closed");
        GCHandle pin=GCHandle.Alloc(data,GCHandleType.Pinned);
        try {
            Sptd q=new Sptd();q.Length=(ushort)Marshal.SizeOf(typeof(Sptd));q.Path=0;q.Target=1;q.Lun=0;q.CdbLength=(byte)cdb.Length;
            q.Direction=(byte)(input?1:0);q.DataLength=(uint)data.Length;q.Timeout=5;q.Data=pin.AddrOfPinnedObject();q.Cdb=new byte[16];Array.Copy(cdb,q.Cdb,cdb.Length);
            Sptd response=q;uint returned;
            bool ok=DeviceIoControl(handle,0x4d014u,ref q,q.Length,ref response,q.Length,out returned,IntPtr.Zero);
            if(!ok || returned<q.Length || response.Status!=0 || response.DataLength!=data.Length) throw new IOException("scsi_transfer_incomplete");
            return data;
        } finally {pin.Free();}
    }
    static ushort Crc(byte[] b) {int c=0;foreach(byte v in b){c^=v<<8;for(int i=0;i<8;i++)c=((c<<1)^((c&0x8000)!=0?0x1021:0))&65535;}return (ushort)c;}
    static byte[] Args(int address,int length,bool crc,byte[] data) {
        byte[] a=new byte[crc?9:6];a[0]=(byte)(address>>24);a[1]=(byte)(address>>16);a[2]=(byte)(address>>8);a[3]=(byte)address;a[4]=(byte)(length>>8);a[5]=(byte)length;
        if(crc){ushort c=Crc(data);a[6]=0;a[7]=(byte)c;a[8]=(byte)(c>>8);}return a;
    }
    static byte[] Cdb(ushort opcode,byte[] args) {byte[] c=Enumerable.Repeat((byte)255,16).ToArray();c[0]=(byte)(opcode>>8);c[1]=(byte)opcode;Array.Copy(args,0,c,2,args.Length);return c;}
    byte[] Command(ushort opcode,byte[] args) {byte[] r=Execute(Cdb(opcode,args),new byte[16],true);if(r[0]!=(byte)(opcode>>8)||r[1]!=(byte)opcode)throw new IOException("scsi_echo_mismatch");return r.Skip(2).ToArray();}
    void RequireLoaded(){if(!loaded||reset)throw new IOException("helper_not_ready");}
    public void LoadPinnedHelper(byte[] helper) {
        if(loaded || helper==null || helper.Length!=24064 || Fm1FlashEngine.Sha(helper)!="d41da6126760c9d66660bcc0cac8d27d221806c5e369a8036921efe68dca5376")throw new IOException("helper_rejected");
        for(int o=0;o<helper.Length;o+=512){byte[] p=helper.Skip(o).Take(512).ToArray();Execute(Cdb(0xfb06,Args(0x1c02000+o,512,true,p)),p,false);}
        Command(0xfb08,Args(0x1c02000,1,false,null));
        Thread.Sleep(300);
        byte[] online=Command(0xfc0a,new byte[0]);
        if(online[0]!=3 || BitConverter.ToUInt32(online,2)!=0x856014)throw new IOException("flash_identity_mismatch");
        loaded=true;
    }
    public int Status(){RequireLoaded();return Command(0xfc03,new byte[0])[0];}
    public byte[] ReadPage(int address){RequireLoaded();if(address<0||address%256!=0||address>1048576-256)throw new IOException("read_range_invalid");return Execute(Cdb(0xfd05,Args(address,256,false,null)),new byte[256],true);}
    public void EraseSector(int address){RequireLoaded();if(address<0x4000||address%4096!=0||address>=0x93000)throw new IOException("erase_range_invalid");if(Command(0xfb01,Args(address,0,false,null).Take(4).ToArray())[0]!=0)throw new IOException("erase_failed");}
    public void ProgramPage(int address,byte[] page){RequireLoaded();if(address<0x4000||address%256!=0||address>=0x93000||page==null||page.Length!=256)throw new IOException("program_range_invalid");Execute(Cdb(0xfb04,Args(address,256,true,page)),page,false);}
    public void ResetVerified(){RequireLoaded();try{Command(0xfc0c,new byte[]{0,0,0,1});}finally{reset=true;}}
    public void Dispose(){handle.Dispose();}
}

public sealed class Fm1FlashEngine : IDisposable {
    readonly IFm1FlashProtocol protocol;
    readonly byte[] application;
    readonly string target;
    readonly Action<string> journal;
    readonly Action identityCheck;
    byte[] baseline;
    FlashPlan plan;
    int statusMask=-1,verifiedPrefix,uncertain=-1;
    bool prepared,failed,readback,reset,installStarted;
    public int MutationAttempts {get;private set;}
    public Fm1FlashEngine(IFm1FlashProtocol p,byte[] app,string build,Action<string> log,Action check){protocol=p;application=(byte[])app.Clone();target=build;journal=log;identityCheck=check;}
    public static string Sha(byte[] b){using(SHA256 h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
    static FlashPlan CopyPlan(FlashPlan p){return new FlashPlan{Candidate=(byte[])p.Candidate.Clone(),BaselineSha256=p.BaselineSha256,CandidateSha256=p.CandidateSha256,ApplicationSha256=p.ApplicationSha256,TargetBuildSha256=p.TargetBuildSha256,Sectors=(int[])p.Sectors.Clone()};}
    void Log(string name,string fields){journal("{\"event\":\""+name+"\""+fields+"}");}
    void Check(){if(reset)throw new IOException("session_reset");identityCheck();}
    void Ready(){Stopwatch watch=Stopwatch.StartNew();while(watch.ElapsedMilliseconds<30000){int s=protocol.Status();if(s<0||s>255||watch.ElapsedMilliseconds>=30000)throw new IOException("status_invalid");if(statusMask>=0&&(s&252)!=statusMask)throw new IOException("status_bits_changed");if((s&1)==0){if((s&2)!=0)throw new IOException("write_enable_still_set");if(statusMask<0)statusMask=s&252;return;}Thread.Sleep(10);}throw new IOException("flash_busy_timeout");}
    byte[] Read(int offset,int length){byte[] b=new byte[length];for(int o=0;o<length;o+=256){byte[] p=protocol.ReadPage(offset+o);if(p==null||p.Length!=256)throw new IOException("short_read");Array.Copy(p,0,b,o,256);}return b;}
    static bool Equal(byte[] a,int ao,byte[] b,int bo,int n){for(int i=0;i<n;i++)if(a[ao+i]!=b[bo+i])return false;return true;}
    byte[] Full(string stage,byte[] expected){Check();Ready();byte[] b=Read(0,1048576);if(expected!=null&&!Equal(b,0,expected,0,b.Length))throw new IOException("full_readback_mismatch");Ready();Log(stage,",\"sha256\":\""+Sha(b)+"\"");return b;}
    public FlashPlan Prepare(byte[] helper){if(prepared||failed||installStarted)throw new IOException("prepare_consumed");try{Check();Log("helper_intent","");protocol.LoadPinnedHelper(helper);baseline=Full("baseline_read_1",null);Full("baseline_read_2",baseline);plan=FlashPolicy.Plan(baseline,application,target);prepared=true;Log("prepared",",\"baseline_sha256\":\""+plan.BaselineSha256+"\",\"candidate_sha256\":\""+plan.CandidateSha256+"\"");return CopyPlan(plan);}catch{failed=true;throw;}}
    public byte[] Baseline(){if(!prepared)throw new IOException("not_prepared");return (byte[])baseline.Clone();}
    void Mutate(int address,byte[] data){Ready();Log("mutation_intent",",\"operation\":\""+(data==null?"erase":"program")+"\",\"address\":"+address+",\"sha256\":\""+(data==null?"":Sha(data))+"\"");MutationAttempts++;if(data==null)protocol.EraseSector(address);else protocol.ProgramPage(address,data);Ready();byte[] expected=data??Enumerable.Repeat((byte)255,4096).ToArray();if(!Equal(Read(address,expected.Length),0,expected,0,expected.Length))throw new IOException("mutation_readback_mismatch");Log("mutation_verified",",\"address\":"+address);}
    public FlashPlan Install(string reviewedCandidate,bool recover){
        if(!prepared||reset||readback||plan.CandidateSha256!=reviewedCandidate)throw new IOException("review_changed");
        if((installStarted&&!recover)||(recover&&!failed))throw new IOException("explicit_recovery_required");
        try{
            Check();installStarted=true;
            if(recover){
                // Same live handle/session only. A known mutation intent permits
                // replacement of exactly the next uncertain whole erase sector.
                byte[] current=Full("recovery_read_1",null);Full("recovery_read_2",current);
                for(int o=0;o<1048576;o++){
                    int index=Array.IndexOf(plan.Sectors,o/4096*4096);
                    if(uncertain>=0&&index==uncertain)continue;
                    byte expected=(index>=0&&index<verifiedPrefix)?plan.Candidate[o]:baseline[o];
                    if(current[o]!=expected)throw new IOException("recovery_scope_mismatch");
                }
                failed=false;
            }else{Full("install_preflight_1",baseline);Full("install_preflight_2",baseline);}
            for(int i=verifiedPrefix;i<plan.Sectors.Length;i++){
                int s=plan.Sectors[i];Check();Ready();
                if(i!=uncertain&&!Equal(Read(s,4096),0,baseline,s,4096))throw new IOException("sector_preimage_changed");
                Log("sector_intent",",\"address\":"+s+",\"index\":"+i);uncertain=i;
                Mutate(s,null);
                for(int p=s;p<s+4096;p+=256){byte[] page=new byte[256];Buffer.BlockCopy(plan.Candidate,p,page,0,256);Mutate(p,page);}
                if(!Equal(Read(s,4096),0,plan.Candidate,s,4096))throw new IOException("sector_readback_mismatch");
                Log("sector_verified",",\"address\":"+s+",\"index\":"+i);verifiedPrefix=i+1;uncertain=-1;
            }
            Full("final_read_1",plan.Candidate);Full("final_read_2",plan.Candidate);Log("readback_complete",",\"candidate_sha256\":\""+plan.CandidateSha256+"\"");readback=true;return CopyPlan(plan);
        }catch{failed=true;try{Log("stopped",",\"mutation_attempts\":"+MutationAttempts);}catch{}throw;}
    }
    public void Reset(){if(!readback||reset||failed)throw new IOException("reset_not_verified");Check();Log("reset_intent","");reset=true;protocol.ResetVerified();Log("reset_complete","");}
    public void Dispose(){protocol.Dispose();}
}
