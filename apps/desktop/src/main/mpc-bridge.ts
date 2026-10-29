import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { createInterface } from 'node:readline'

export interface MpcBridge {
  slaveWindow: string
  onEnded(listener: () => void): () => void
  load(args: string[]): Promise<void>
  close(): void
}

// Bundled as source so packaged builds do not need a compiler or a separate executable.
// Paths travel as JSON on stdin, never as PowerShell source. One hidden message window per player.
export const MPC_BRIDGE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class TheamaMpcWindow : NativeWindow {
  [StructLayout(LayoutKind.Sequential)] public struct CopyData {
    public IntPtr tag; public int size; public IntPtr data;
  }
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(
    IntPtr hwnd, uint msg, IntPtr sender, ref CopyData data, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr first, IntPtr second);
  static readonly object outputLock = new object();
  static readonly ManualResetEvent started = new ManualResetEvent(false);
  static TheamaMpcWindow window;
  static Exception startupError;
  static IntPtr playerWindow;
  static int lastLoadState = -1;
  public static void Write(string json) { lock(outputLock) { Console.WriteLine(json); Console.Out.Flush(); } }
  public static void Start() {
    var thread = new Thread(() => {
      try {
        window = new TheamaMpcWindow();
        window.CreateHandle(new CreateParams { Caption = "Theama MPC control" });
        started.Set();
        Application.Run();
      } catch(Exception e) { startupError = e; started.Set(); }
    });
    thread.IsBackground = true;
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    if(!started.WaitOne(5000)) throw new Exception("MPC control window timed out");
    if(startupError != null) throw startupError;
    Write("{\"event\":\"ready\",\"window\":\"" + window.Handle.ToInt64() + "\"}");
  }
  protected override void WndProc(ref Message m) {
    if(m.Msg == 0x4a && m.LParam != IntPtr.Zero) {
      var data = (CopyData)Marshal.PtrToStructure(m.LParam, typeof(CopyData));
      if(data.size >= 2 && data.size <= 131072 && data.size % 2 == 0 && data.data != IntPtr.Zero) {
        string value = Marshal.PtrToStringUni(data.data, data.size / 2).TrimEnd('\0');
        if(data.tag.ToInt64() == 0x50000000 && playerWindow == IntPtr.Zero) {
          long handle;
          if(Int64.TryParse(value, out handle) && new IntPtr(handle) == m.WParam) playerWindow = m.WParam;
        }
        if(data.tag.ToInt64() == 0x50000001 && m.WParam == playerWindow) {
          int state;
          if(Int32.TryParse(value, out state)) {
            // Runtime-only "After Playback: Do Nothing" overrides folder/playlist auto-advance.
            // Command 948 toggles a launch flag, so send it once per loaded file, not per notification.
            if(state == 2 && lastLoadState != 2) PostMessage(playerWindow, 0x111, new IntPtr(948), IntPtr.Zero);
            lastLoadState = state;
          }
        }
        Write("{\"event\":\"message\",\"command\":" + data.tag.ToInt64() +
          ",\"sender\":\"" + m.WParam.ToInt64() + "\",\"data\":\"" + Convert.ToBase64String(Encoding.Unicode.GetBytes(value)) + "\"}");
        m.Result = new IntPtr(1);
        return;
      }
    }
    base.WndProc(ref m);
  }
  public static void Load(string target, string[] args) {
    byte[] strings = Encoding.Unicode.GetBytes(String.Join("\0", args) + "\0");
    byte[] payload = new byte[4 + strings.Length];
    Array.Copy(BitConverter.GetBytes(args.Length), payload, 4);
    Array.Copy(strings, 0, payload, 4, strings.Length);
    IntPtr memory = Marshal.AllocHGlobal(payload.Length);
    try {
      Marshal.Copy(payload, 0, memory, payload.Length);
      var data = new CopyData { tag = new IntPtr(0x6ABE51), size = payload.Length, data = memory };
      IntPtr result;
      if(SendMessageTimeout(new IntPtr(Int64.Parse(target)), 0x4a, window.Handle,
        ref data, 2, 3000, out result) == IntPtr.Zero || result == IntPtr.Zero)
        throw new Exception("MPC did not accept the next episode");
    } finally { Marshal.FreeHGlobal(memory); }
  }
}
'@
[TheamaMpcWindow]::Start()
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    [TheamaMpcWindow]::Load([string]$request.window, [string[]]$request.args)
    [TheamaMpcWindow]::Write('{"event":"loaded"}')
  } catch {
    [TheamaMpcWindow]::Write('{"event":"error"}')
  }
}
`

/** Native EOF notifications and targeted file opening shared by MPC-HC and MPC-BE. */
export function createMpcBridge(): Promise<MpcBridge> {
  return new Promise((resolve, reject) => {
    const exe = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(MPC_BRIDGE_SCRIPT, 'utf16le').toString('base64')], {
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const lines = createInterface({ input: child.stdout })
    const ended = new Set<() => void>()
    let target: string | undefined
    let pending: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined
    let disposed = false
    const fail = (): void => {
      if (disposed) return
      disposed = true
      clearTimeout(startupTimer)
      clearTimeout(pending?.timer)
      pending?.reject(new Error('MPC control connection closed'))
      pending = undefined
      reject(new Error('MPC control connection could not be started'))
      lines.close()
      child.kill()
    }
    const startupTimer = setTimeout(fail, 10_000)
    child.once('error', fail)
    child.once('exit', fail)
    // Drain stderr without exposing script errors or filenames in logs.
    child.stderr.resume()
    child.stdin.on('error', fail)
    lines.on('line', (line) => {
      let msg: { event?: string; window?: string; command?: number; sender?: string; data?: string }
      try { msg = JSON.parse(line) as typeof msg } catch { return }
      if (msg.event === 'ready' && msg.window && /^\d+$/.test(msg.window)) {
        clearTimeout(startupTimer)
        resolve({
          slaveWindow: msg.window,
          onEnded: (listener) => { ended.add(listener); return () => { ended.delete(listener) } },
          load: async (args) => {
            if (disposed || !target) throw new Error('MPC control connection is unavailable')
            if (pending) throw new Error('MPC is already opening a file')
            return new Promise<void>((resolveLoad, rejectLoad) => {
              const timer = setTimeout(() => {
                pending = undefined
                rejectLoad(new Error('MPC did not confirm the next episode'))
              }, 4000)
              pending = { resolve: resolveLoad, reject: rejectLoad, timer }
              child.stdin.write(`${JSON.stringify({ window: target, args })}\n`)
            })
          },
          close: () => { ended.clear(); fail() },
        })
      } else if (msg.event === 'message' && typeof msg.data === 'string') {
        if (msg.command === 0x50000000) {
          const hwnd = Buffer.from(msg.data, 'base64').toString('utf16le')
          if (!target && /^\d+$/.test(hwnd) && msg.sender === hwnd) target = hwnd
        } else if (msg.command === 0x50000009 && target === msg.sender) {
          ended.forEach((listener) => listener())
        }
      } else if (msg.event === 'loaded' || msg.event === 'error') {
        clearTimeout(pending?.timer)
        if (msg.event === 'loaded') pending?.resolve()
        else pending?.reject(new Error('MPC could not open the next episode'))
        pending = undefined
      }
    })
  })
}
