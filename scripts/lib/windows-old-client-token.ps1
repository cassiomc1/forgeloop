param(
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$EntryPoint,
  [string]$ProjectPath,
  [string]$TaskId,
  [switch]$ProbeRead
)
$ErrorActionPreference = 'Stop'
# This process and its future children only. No account/policy/existing-process
# token is modified. The native test controller retains its original token.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class OrdinaryOldClientToken {
  [StructLayout(LayoutKind.Sequential)] private struct Luid { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] private struct Privileges { public uint Count; public Luid Value; public uint Attributes; }
  [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool LookupPrivilegeValue(string system, string name, out Luid value);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref Privileges privileges, uint length, IntPtr previous, IntPtr returned);
  public static void Remove(string name) {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 0x20 | 0x8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      Luid value;
      if (!LookupPrivilegeValue(null, name, out value)) throw new Win32Exception(Marshal.GetLastWin32Error());
      var privileges = new Privileges { Count = 1, Value = value, Attributes = 4 }; // SE_PRIVILEGE_REMOVED
      SetLastError(0);
      if (!AdjustTokenPrivileges(token, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
      var removedError = Marshal.GetLastWin32Error();
      if (removedError != 0 && removedError != 1300) throw new Win32Exception(removedError);
      // A removed/absent privilege must be impossible to enable in this token.
      privileges.Attributes = 2; // SE_PRIVILEGE_ENABLED
      SetLastError(0);
      if (!AdjustTokenPrivileges(token, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (Marshal.GetLastWin32Error() != 1300) throw new InvalidOperationException("Privilege remains available: " + name);
    } finally { CloseHandle(token); }
  }
}
'@
[OrdinaryOldClientToken]::Remove('SeBackupPrivilege')
[OrdinaryOldClientToken]::Remove('SeRestorePrivilege')
if ($ProbeRead) {
  $probe = @'
const fs = require('fs');
try { fs.readFileSync(process.argv[1]); console.log(JSON.stringify({allowed:true})); process.exit(2); }
catch (error) { console.log(JSON.stringify({code:error.code})); process.exit(['EACCES','EPERM'].includes(error.code) ? 0 : 1); }
'@
  & $NodeExe '-e' $probe $EntryPoint
} else {
  if (!$ProjectPath -or !$TaskId) { throw 'Old CLI requires project path and task ID' }
  & $NodeExe $EntryPoint 'task-create' '--path' $ProjectPath '--task' $TaskId '--json'
}
exit $LASTEXITCODE
