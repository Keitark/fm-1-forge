# Passive WinMM system metadata only: no MIDI open, MIDI send or device-control traffic.
# DRV_QUERYDEVICEINTERFACE and SIZE are intercepted by the Windows multimedia system.
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
public static class FM1StockWindowsMetadata {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 struct InCaps { public ushort mid,pid; public uint version; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string name; public uint support; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 struct OutCaps { public ushort mid,pid; public uint version; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string name; public ushort technology,voices,notes,mask; public uint support; }
 [DllImport("winmm.dll")] static extern uint midiInGetNumDevs();
 [DllImport("winmm.dll")] static extern uint midiOutGetNumDevs();
 [DllImport("winmm.dll",CharSet=CharSet.Unicode)] static extern uint midiInGetDevCapsW(UIntPtr id,out InCaps caps,uint size);
 [DllImport("winmm.dll",CharSet=CharSet.Unicode)] static extern uint midiOutGetDevCapsW(UIntPtr id,out OutCaps caps,uint size);
 [DllImport("winmm.dll")] static extern uint midiInMessage(UIntPtr id,uint msg,IntPtr first,UIntPtr second);
 [DllImport("winmm.dll")] static extern uint midiOutMessage(UIntPtr id,uint msg,IntPtr first,UIntPtr second);
 public class Endpoint { public string direction,name,vid,pid,mi,instanceHash; public uint index; public bool interfaceQueryOk; }
 public static Endpoint[] Read() {
  var output=new List<Endpoint>();
  foreach(bool input in new bool[]{true,false}) {
   uint count=input?midiInGetNumDevs():midiOutGetNumDevs();
   if(count>256)throw new InvalidOperationException("MIDI count limit");
   for(uint id=0;id<count;id++) {
    string name; uint error;
    if(input){InCaps c;error=midiInGetDevCapsW((UIntPtr)id,out c,(uint)Marshal.SizeOf(typeof(InCaps)));name=c.name;}
    else{OutCaps c;error=midiOutGetDevCapsW((UIntPtr)id,out c,(uint)Marshal.SizeOf(typeof(OutCaps)));name=c.name;}
    if(error!=0)throw new InvalidOperationException("MIDI caps unavailable");
    var endpoint=new Endpoint{direction=input?"in":"out",index=id,name=name+" "+id,interfaceQueryOk=false};
    string devicePath=null;
    IntPtr size=Marshal.AllocHGlobal(4);
    try {
     Marshal.WriteInt32(size,0);
     error=input?midiInMessage((UIntPtr)id,0x80d,size,UIntPtr.Zero):midiOutMessage((UIntPtr)id,0x80d,size,UIntPtr.Zero);
     int bytes=Marshal.ReadInt32(size);
     if(error==0 && bytes>=2 && bytes<=8192 && (bytes&1)==0) {
      IntPtr text=Marshal.AllocHGlobal(bytes);
      try {
       error=input?midiInMessage((UIntPtr)id,0x80c,text,(UIntPtr)(uint)bytes):midiOutMessage((UIntPtr)id,0x80c,text,(UIntPtr)(uint)bytes);
       if(error==0){devicePath=Marshal.PtrToStringUni(text,bytes/2).TrimEnd('\0');endpoint.interfaceQueryOk=true;}
      } finally{Marshal.FreeHGlobal(text);}
     }
    } finally{Marshal.FreeHGlobal(size);}
    if(devicePath!=null) {
     var match=Regex.Match(devicePath.ToLowerInvariant(),@"^\\\\\?\\usb#vid_([0-9a-f]{4})&pid_([0-9a-f]{4})&mi_([0-9a-f]{2})#([^#]+)#\{[0-9a-f-]{36}\}(?:\\.*)?$");
     if(match.Success) {
      endpoint.vid=match.Groups[1].Value;endpoint.pid=match.Groups[2].Value;endpoint.mi=match.Groups[3].Value;
      string identity="usb#vid_"+endpoint.vid+"&pid_"+endpoint.pid+"&mi_"+endpoint.mi+"#"+match.Groups[4].Value;
      using(var sha=SHA256.Create()){endpoint.instanceHash=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-","").ToLowerInvariant();}
     }
    }
    output.Add(endpoint);
   }
  }
  return output.ToArray();
 }
}
'@
ConvertTo-Json -InputObject @([FM1StockWindowsMetadata]::Read()) -Depth 4 -Compress
