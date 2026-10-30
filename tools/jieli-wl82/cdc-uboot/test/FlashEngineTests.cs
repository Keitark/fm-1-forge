// Offline injected-transport checks. No native handles or device APIs are used.
using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;

public static class FlashEngineTests {
    sealed class Fake : IFm1FlashProtocol {
        public byte[] Memory;
        public readonly List<string> Events=new List<string>();
        public readonly List<int> Erased=new List<int>(), Programmed=new List<int>();
        public readonly Queue<int> StatusValues=new Queue<int>();
        public int Reads, Loads, Resets, EraseCalls, ProgramCalls;
        public int ThrowErase=-1,ThrowProgram=-1,CorruptProgram=-1,ThrowEraseAddress=-1;
        public bool HelperFails,ShortRead,FailJournal;
        bool loaded;
        public Fake(byte[] source){Memory=(byte[])source.Clone();}
        public void Log(string text){if(FailJournal&&text.Contains("mutation_intent"))throw new IOException("disk_full");Events.Add("J:"+text);}
        public void LoadPinnedHelper(byte[] helper){Loads++;Events.Add("H");if(loaded||HelperFails)throw new IOException("helper_failed");loaded=true;}
        void Loaded(){if(!loaded)throw new IOException("fake_not_loaded");}
        public int Status(){Loaded();return StatusValues.Count>0?StatusValues.Dequeue():0;}
        public byte[] ReadPage(int address){Loaded();Check(address>=0&&address%256==0&&address+256<=1048576,"read bounds");Reads++;if(ShortRead)return new byte[255];byte[] page=new byte[256];Buffer.BlockCopy(Memory,address,page,0,256);return page;}
        void Intent(){Check(Events.Count>0&&Events.Last().Contains("mutation_intent"),"intent must persist before hardware mutation");}
        public void EraseSector(int address){Loaded();Check(address>=0x4000&&address<0x93000&&address%4096==0,"erase bounds");Intent();EraseCalls++;Erased.Add(address);Events.Add("E:"+address);for(int i=address;i<address+4096;i++)Memory[i]=255;if(EraseCalls==ThrowErase||address==ThrowEraseAddress){ThrowEraseAddress=-1;throw new IOException("erase_lost");}}
        public void ProgramPage(int address,byte[] page){Loaded();Check(address>=0x4000&&address<0x93000&&address%256==0&&page.Length==256,"program bounds");Intent();ProgramCalls++;Programmed.Add(address);Events.Add("P:"+address);int count=ProgramCalls==ThrowProgram?128:256;for(int i=0;i<count;i++)Memory[address+i]&=page[i];if(ProgramCalls==CorruptProgram)Memory[address]^=1;if(ProgramCalls==ThrowProgram)throw new IOException("program_lost");}
        public void ResetVerified(){Loaded();Resets++;Events.Add("R");}
        public void Dispose(){}
    }
    static int assertions,cases;
    static void Check(bool value,string message){assertions++;if(!value)throw new InvalidOperationException("TEST: "+message);}
    static void Reject(Action run,string message){bool rejected=false;try{run();}catch(IOException){rejected=true;}catch(InvalidOperationException error){if(error.Message.StartsWith("TEST:"))throw;rejected=true;}Check(rejected,message);}
    static Fm1FlashEngine Engine(Fake f,byte[] app,string build){return new Fm1FlashEngine(f,app,build,f.Log,()=>f.Events.Add("I"));}
    static byte[] Helper(){return new byte[]{1};}
    static void Same(byte[] a,byte[] b,string message){Check(a.SequenceEqual(b),message);}
    static int EventCount(Fake f,string name){return f.Events.Count(e=>e.StartsWith("J:")&&e.Contains("\"event\":\""+name+"\""));}
    public static string Run(byte[] baseline,byte[] originalApp,byte[] nextApp,byte[] maxApp,string build){
        assertions=cases=0;
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,nextApp,build)){
                FlashPlan p=e.Prepare(Helper());Check(f.Loads==1&&f.Reads==8192,"prepare loads once and full reads twice");Check(f.EraseCalls==0&&f.ProgramCalls==0&&f.Resets==0,"prepare never mutates array/reset");
                Same(e.Baseline(),baseline,"baseline exact");byte[] exposed=e.Baseline();exposed[0]^=1;Same(e.Baseline(),baseline,"baseline isolated");
                Reject(()=>e.Prepare(Helper()),"prepare single use");Reject(()=>e.Reset(),"reset before verification denied");
                Reject(()=>e.Install(p.CandidateSha256,true),"recovery requires a failed original session");
                int reads=f.Reads;Reject(()=>e.Install(new string('f',64),false),"unreviewed hash rejected");Check(f.Reads==reads&&f.EraseCalls==0,"bad review no IO");
                // Returned plans must never give callers access to private write scope.
                string reviewed=p.CandidateSha256;p.Candidate[0]^=1;p.Sectors[0]=0;p.CandidateSha256="bad";
                FlashPlan installed=e.Install(reviewed,false);FlashPlan expected=FlashPolicy.Plan(baseline,nextApp,build);Same(f.Memory,expected.Candidate,"plan mutation cannot change installed image");
                Check(f.Erased.SequenceEqual(expected.Sectors),"exact sector order with directory last");Check(expected.Sectors.Last()==0x4000,"directory last");
                Check(f.ProgramCalls==expected.Sectors.Length*16,"all pages written once");Check(e.MutationAttempts==f.EraseCalls+f.ProgramCalls,"mutation attempts exact");
                Check(EventCount(f,"mutation_intent")==e.MutationAttempts&&EventCount(f,"mutation_verified")==e.MutationAttempts,"per mutation intent and readback");
                Check(EventCount(f,"final_read_1")==1&&EventCount(f,"final_read_2")==1,"double final readback");Check(f.Resets==0,"install never auto resets");
                installed.Candidate[0]^=1;installed.Sectors[0]=0;e.Reset();Check(f.Resets==1,"explicit verified reset once");Reject(()=>e.Reset(),"duplicate reset denied");Reject(()=>e.Install(reviewed,false),"installed engine cannot rerun");
            }cases++;
        }
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,originalApp,build)){FlashPlan p=e.Prepare(Helper());Check(p.NoChanges&&p.Sectors.Length==0,"zero change plan");e.Install(p.CandidateSha256,false);Check(f.Reads==6*4096,"prepare preflight and final each twice");Check(f.EraseCalls==0&&f.ProgramCalls==0&&e.MutationAttempts==0,"zero change no mutations");e.Reset();Check(f.Resets==1,"zero change verified return reset");}cases++;
        }
        {
            Fake f=new Fake(baseline);f.HelperFails=true;using(Fm1FlashEngine e=Engine(f,nextApp,build)){Reject(()=>e.Prepare(Helper()),"failed helper fails prepare");Reject(()=>e.Prepare(Helper()),"failed helper never reuploaded");Reject(()=>e.Install("bad",true),"failed preparation cannot recover as write");Check(f.Loads==1&&f.Reads==0&&f.EraseCalls==0&&f.Resets==0,"helper failure closes path");}cases++;
        }
        {
            Fake f=new Fake(baseline);f.ShortRead=true;using(Fm1FlashEngine e=Engine(f,nextApp,build)){Reject(()=>e.Prepare(Helper()),"short baseline read");Reject(()=>e.Prepare(Helper()),"short preparation consumed");Check(f.EraseCalls==0&&f.Resets==0,"short read no mutations");}cases++;
        }
        foreach(int bad in new[]{2,256,-1}){
            Fake f=new Fake(baseline);f.StatusValues.Enqueue(bad);using(Fm1FlashEngine e=Engine(f,nextApp,build)){Reject(()=>e.Prepare(Helper()),"invalid/WEL status");Check(f.EraseCalls==0&&f.Resets==0,"bad status stops");}cases++;
        }
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,nextApp,build)){FlashPlan p=e.Prepare(Helper());f.StatusValues.Enqueue(1);f.StatusValues.Enqueue(0);e.Install(p.CandidateSha256,false);Check(f.EraseCalls>0,"busy then ready accepted");}cases++;
        }
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,nextApp,build)){FlashPlan p=e.Prepare(Helper());f.StatusValues.Enqueue(4);Reject(()=>e.Install(p.CandidateSha256,false),"nonbusy bits changed");Check(f.EraseCalls==0&&f.Resets==0,"status bit failure no mutation/reset");}cases++;
        }
        foreach(bool program in new[]{false,true}){
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,nextApp,build)){FlashPlan p=e.Prepare(Helper());if(program)f.ThrowProgram=3;else f.ThrowErase=2;
                Reject(()=>e.Install(p.CandidateSha256,false),"interrupted mutation");int erases=f.EraseCalls,writes=f.ProgramCalls;Reject(()=>e.Install(p.CandidateSha256,false),"no automatic retry");Reject(()=>e.Reset(),"failed mutation no reset");Check(f.EraseCalls==erases&&f.ProgramCalls==writes&&f.Resets==0,"failure retains counts");
                f.ThrowProgram=-1;f.ThrowErase=-1;e.Install(p.CandidateSha256,true);Same(f.Memory,p.Candidate,"explicit same-session recovery exact");Check(f.Loads==1,"recovery never uploads helper");Check(f.Resets==0,"recovery no automatic reset");
                if(!program)Check(f.Erased.Count(address=>address==p.Sectors[0])==1,"recovery skips the verified prefix");
            }cases++;
        }
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,nextApp,build)){FlashPlan p=e.Prepare(Helper());f.CorruptProgram=1;Reject(()=>e.Install(p.CandidateSha256,false),"per-page mismatch");Check(f.ProgramCalls==1&&f.Resets==0,"corrupt page stops before next page");}cases++;
        }
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,nextApp,build)){FlashPlan p=e.Prepare(Helper());f.FailJournal=true;Reject(()=>e.Install(p.CandidateSha256,false),"journal failure before mutation");Check(f.EraseCalls==0&&f.ProgramCalls==0&&e.MutationAttempts==0,"intent failure prevents mutation");}cases++;
        }
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,nextApp,build)){FlashPlan p=e.Prepare(Helper());f.ThrowErase=1;Reject(()=>e.Install(p.CandidateSha256,false),"prepare recovery scope");f.ThrowErase=-1;f.Memory[0xff010]^=1;int erases=f.EraseCalls;Reject(()=>e.Install(p.CandidateSha256,true),"protected other sector differs");Check(f.EraseCalls==erases&&f.Resets==0,"bad recovery no further mutation");}cases++;
        }
        {
            Fake f=new Fake(baseline);using(Fm1FlashEngine e=Engine(f,maxApp,build)){FlashPlan p=e.Prepare(Helper());f.ThrowEraseAddress=0x92000;Reject(()=>e.Install(p.CandidateSha256,false),"shared configuration erase interrupted");Check(f.Memory[0x920dc]==255,"known uncertain shared sector includes preserved bytes");int prefix=f.Erased.Count;e.Install(p.CandidateSha256,true);Same(f.Memory,p.Candidate,"same live-session recovery restores original shared bytes");Check(f.Erased.Count==prefix+2,"only uncertain sector then directory remain");Same(f.Memory.Skip(0x920dc).ToArray(),baseline.Skip(0x920dc).ToArray(),"configuration/reserved bytes preserved after recovery");}cases++;
        }
        return "{\"cases\":"+cases+",\"assertions\":"+assertions+",\"hardware_io\":false}";
    }
}
