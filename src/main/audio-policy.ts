import { spawn } from 'node:child_process'

/**
 * Reads and sets the Windows default audio endpoints.
 *
 * This is what removes the "now go into Discord and pick CABLE Output" step:
 * voice apps overwhelmingly follow the default *communications* device, so
 * pointing that at the cable configures every one of them at once.
 *
 * There is no public API for setting a default endpoint — Windows exposes it
 * only through the undocumented IPolicyConfig COM interface, which has been
 * stable from Vista through Windows 11 and is what every audio switcher uses.
 * We drive it from inline C# so there is no native module to compile and no
 * third-party binary to ship.
 */

export type EndpointRole = 'console' | 'multimedia' | 'communications'
export type DataFlow = 'render' | 'capture'

export interface Endpoint {
  id: string
  name: string
}

const ROLE_INDEX: Record<EndpointRole, number> = {
  console: 0,
  multimedia: 1,
  communications: 2
}

const FLOW_INDEX: Record<DataFlow, number> = { render: 0, capture: 1 }

/** Inline C# COM bindings, compiled by Add-Type on first use. */
const CSHARP = `
using System;
using System.Text;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY { public Guid fmtid; public int pid; }

[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  [PreserveSig] int GetDevice(string id, out IMMDevice device);
  [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
  [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection {
  [PreserveSig] int GetCount(out int count);
  [PreserveSig] int Item(int index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore properties);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetState(out int state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  [PreserveSig] int GetCount(out int count);
  [PreserveSig] int GetAt(int index, out PROPERTYKEY key);
  [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
  [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
  [PreserveSig] int Commit();
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
public class CPolicyConfigClient { }

[ComImport, Guid("294935CE-F637-4E7C-A41B-AB255460B862")]
public class CPolicyConfigVistaClient { }

// Windows 10 19045 exposes SetDefaultEndpoint only through this pair; the
// coclass above answers QueryInterface with E_NOINTERFACE for both policy
// interfaces there. Note the vtable has no ResetDeviceFormat, so the method
// order differs from IPolicyConfig and the two cannot be interchanged.
[ComImport, Guid("568B9108-44BF-40B4-9006-86AFE5B5A620"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfigVista {
  [PreserveSig] int GetMixFormat(string name, out IntPtr format);
  [PreserveSig] int GetDeviceFormat(string name, bool def, out IntPtr format);
  [PreserveSig] int SetDeviceFormat(string name, IntPtr endpoint, IntPtr mix);
  [PreserveSig] int GetProcessingPeriod(string name, bool def, out long dflt, out long min);
  [PreserveSig] int SetProcessingPeriod(string name, ref long period);
  [PreserveSig] int GetShareMode(string name, out IntPtr mode);
  [PreserveSig] int SetShareMode(string name, IntPtr mode);
  [PreserveSig] int GetPropertyValue(string name, ref PROPERTYKEY key, out PROPVARIANT value);
  [PreserveSig] int SetPropertyValue(string name, ref PROPERTYKEY key, ref PROPVARIANT value);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
  [PreserveSig] int SetEndpointVisibility(string name, bool visible);
}

[ComImport, Guid("F8679F50-850A-45DE-BE9B-C4972FCE2C5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfig {
  [PreserveSig] int GetMixFormat(string name, out IntPtr format);
  [PreserveSig] int GetDeviceFormat(string name, bool def, out IntPtr format);
  [PreserveSig] int ResetDeviceFormat(string name);
  [PreserveSig] int SetDeviceFormat(string name, IntPtr endpoint, IntPtr mix);
  [PreserveSig] int GetProcessingPeriod(string name, bool def, out long dflt, out long min);
  [PreserveSig] int SetProcessingPeriod(string name, ref long period);
  [PreserveSig] int GetShareMode(string name, out IntPtr mode);
  [PreserveSig] int SetShareMode(string name, IntPtr mode);
  [PreserveSig] int GetPropertyValue(string name, bool fx, ref PROPERTYKEY key, out PROPVARIANT value);
  [PreserveSig] int SetPropertyValue(string name, bool fx, ref PROPERTYKEY key, ref PROPVARIANT value);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
  [PreserveSig] int SetEndpointVisibility(string name, bool visible);
}

public static class AudioPolicy {
  const int DEVICE_STATE_ACTIVE = 1;
  const int STGM_READ = 0;

  static PROPERTYKEY FriendlyName() {
    PROPERTYKEY key = new PROPERTYKEY();
    key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
    key.pid = 14;
    return key;
  }

  static string NameOf(IMMDevice device) {
    IPropertyStore store;
    if (device.OpenPropertyStore(STGM_READ, out store) != 0) return "";
    PROPERTYKEY key = FriendlyName();
    PROPVARIANT value;
    if (store.GetValue(ref key, out value) != 0) return "";
    return value.p == IntPtr.Zero ? "" : Marshal.PtrToStringUni(value.p);
  }

  public static string List(int dataFlow) {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDeviceCollection devices;
    if (enumerator.EnumAudioEndpoints(dataFlow, DEVICE_STATE_ACTIVE, out devices) != 0) return "";
    int count;
    devices.GetCount(out count);
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < count; i++) {
      IMMDevice device;
      if (devices.Item(i, out device) != 0) continue;
      string id;
      if (device.GetId(out id) != 0) continue;
      sb.Append(id).Append("\\t").Append(NameOf(device)).Append("\\n");
    }
    return sb.ToString();
  }

  public static string GetDefault(int dataFlow, int role) {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice device;
    if (enumerator.GetDefaultAudioEndpoint(dataFlow, role, out device) != 0) return "";
    string id;
    if (device.GetId(out id) != 0) return "";
    return id + "\\t" + NameOf(device);
  }

  /**
   * Which coclass/interface pair works varies by Windows build, so try the
   * documented-by-convention one first and fall back to the Vista pair.
   * Returns 0 on success, otherwise the last HRESULT.
   */
  public static int SetDefault(string deviceId, int role) {
    int last = unchecked((int)0x80004002);

    try {
      IPolicyConfig config = (IPolicyConfig)(new CPolicyConfigClient());
      int hr = config.SetDefaultEndpoint(deviceId, role);
      if (hr == 0) return 0;
      last = hr;
    } catch (Exception) { }

    try {
      IPolicyConfigVista vista = (IPolicyConfigVista)(new CPolicyConfigVistaClient());
      int hr = vista.SetDefaultEndpoint(deviceId, role);
      if (hr == 0) return 0;
      last = hr;
    } catch (Exception) { }

    return last;
  }
}
`

function powershell(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr: stderr.trim() }))
    child.on('error', (err) => resolve({ code: -1, stdout: '', stderr: String(err) }))
  })
}

/** Wraps a call in the Add-Type preamble. Uses a literal here-string so C# is untouched. */
function withBindings(call: string): string {
  return `$ErrorActionPreference='Stop'
$src = @'
${CSHARP}
'@
Add-Type -TypeDefinition $src -Language CSharp | Out-Null
${call}`
}

/** The C# side joins id and name with a tab, which neither field can contain. */
function parseEndpoints(raw: string): Endpoint[] {
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const index = line.indexOf('\t')
      return { id: line.slice(0, index).trim(), name: line.slice(index + 1).trim() }
    })
    .filter((entry) => entry.id.length > 0)
}

export async function listEndpoints(flow: DataFlow): Promise<Endpoint[]> {
  if (process.platform !== 'win32') return []
  const result = await powershell(withBindings(`[AudioPolicy]::List(${FLOW_INDEX[flow]})`))
  if (result.code !== 0) {
    console.warn('[audio-policy] list failed:', result.stderr)
    return []
  }
  return parseEndpoints(result.stdout)
}

export async function getDefaultEndpoint(
  flow: DataFlow,
  role: EndpointRole
): Promise<Endpoint | null> {
  if (process.platform !== 'win32') return null
  const result = await powershell(
    withBindings(`[AudioPolicy]::GetDefault(${FLOW_INDEX[flow]}, ${ROLE_INDEX[role]})`)
  )
  if (result.code !== 0) return null
  return parseEndpoints(result.stdout)[0] ?? null
}

/**
 * Points a default endpoint at a device. Returns the HRESULT — 0 is success.
 * No elevation is needed; this is a per-user setting.
 */
export async function setDefaultEndpoint(deviceId: string, role: EndpointRole): Promise<number> {
  if (process.platform !== 'win32') return -1
  const escaped = deviceId.replace(/'/g, "''")
  const result = await powershell(
    withBindings(`[AudioPolicy]::SetDefault('${escaped}', ${ROLE_INDEX[role]})`)
  )
  if (result.code !== 0) {
    console.warn('[audio-policy] set failed:', result.stderr)
    return -1
  }
  const hresult = Number(result.stdout.trim())
  return Number.isFinite(hresult) ? hresult : -1
}

/**
 * Finds the capture endpoint that pairs with a VB-CABLE / virtual cable.
 * The playback side is "CABLE Input"; the side apps record from is "CABLE Output".
 */
export function findCableCapture(endpoints: Endpoint[]): Endpoint | null {
  const rules: { pattern: RegExp; score: number }[] = [
    { pattern: /cable output/i, score: 100 },
    { pattern: /vb-?[ ]?audio.*(virtual )?cable/i, score: 90 },
    { pattern: /voicemeeter out|voicemeeter output/i, score: 70 },
    { pattern: /virtual cable|\bvac\b/i, score: 60 }
  ]
  const excluded = /nvidia|droidcam|voicemod|realtek|steam streaming/i

  let winner: Endpoint | null = null
  let best = 0
  for (const endpoint of endpoints) {
    if (!endpoint.name || excluded.test(endpoint.name)) continue
    for (const rule of rules) {
      if (rule.pattern.test(endpoint.name) && rule.score > best) {
        best = rule.score
        winner = endpoint
      }
    }
  }
  return winner
}
