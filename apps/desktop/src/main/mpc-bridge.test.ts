import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { createMpcBridge } from './mpc-bridge'

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach((close) => close()) })

// Independent MPC protocol peer: a real Windows message window, not a mocked transport.
const PEER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class FakeMpc : NativeWindow {
  [StructLayout(LayoutKind.Sequential)] struct CopyData { public IntPtr tag; public int size; public IntPtr data; }
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr sender, ref CopyData data, uint flags, uint timeout, out IntPtr result);
  static FakeMpc window;
  static IntPtr host;
  static ManualResetEvent ready = new ManualResetEvent(false);
  public static void Start(string parent) {
    host = new IntPtr(Int64.Parse(parent));
    var thread = new Thread(() => {
      window = new FakeMpc();
      window.CreateHandle(new CreateParams { Caption = "Theama test MPC" });
      Send(0x50000000, window.Handle.ToInt64().ToString());
      Send(0x50000001, "2");
      Send(0x50000001, "2");
      ready.Set();
      Application.Run();
    });
    thread.IsBackground = true;
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    if(!ready.WaitOne(5000)) throw new Exception("Peer window timed out");
    Console.WriteLine("READY");
    Console.Out.Flush();
  }
  static void Send(long command, string value) {
    byte[] bytes = Encoding.Unicode.GetBytes(value + "\0");
    IntPtr memory = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, memory, bytes.Length);
      var data = new CopyData { tag = new IntPtr(command), size = bytes.Length, data = memory };
      IntPtr result;
      if(SendMessageTimeout(host, 0x4a, window.Handle, ref data, 2, 3000, out result) == IntPtr.Zero)
        throw new Exception("Peer message timed out");
    } finally { Marshal.FreeHGlobal(memory); }
  }
  public static void End() { Send(0x50000009, ""); }
  protected override void WndProc(ref Message m) {
    if(m.Msg == 0x111 && m.WParam.ToInt64() == 948) {
      Console.WriteLine("HOLD"); Console.Out.Flush(); m.Result = new IntPtr(1); return;
    }
    if(m.Msg == 0x4a) {
      var data = (CopyData)Marshal.PtrToStructure(m.LParam, typeof(CopyData));
      if(data.tag.ToInt64() == 0x6ABE51) {
        byte[] bytes = new byte[data.size];
        Marshal.Copy(data.data, bytes, 0, data.size);
        Console.WriteLine("OPEN:" + Convert.ToBase64String(bytes));
        Console.Out.Flush();
        m.Result = new IntPtr(1);
        return;
      }
    }
    base.WndProc(ref m);
  }
}
'@
[FakeMpc]::Start($env:THEAMA_TEST_SLAVE_WINDOW)
while ($null -ne ($line = [Console]::ReadLine())) { [FakeMpc]::End() }
`

describe.skipIf(process.platform !== 'win32')('MPC Windows message bridge', () => {
  it('receives native EOF and opens a file in the same window with exact Unicode arguments', async () => {
    const bridge = await createMpcBridge()
    cleanup.push(() => bridge.close())
    const messages: string[] = []
    const peer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PEER, 'utf16le').toString('base64')], {
      windowsHide: true, env: { ...process.env, THEAMA_TEST_SLAVE_WINDOW: bridge.slaveWindow },
    })
    cleanup.push(() => { peer.kill() })
    let stderr = ''
    peer.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    createInterface({ input: peer.stdout }).on('line', (line) => messages.push(line))
    const until = async (probe: () => boolean) => {
      const deadline = Date.now() + 10_000
      while (!probe()) {
        if (Date.now() > deadline) throw new Error(`Peer timed out: ${stderr}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    await until(() => messages.includes('READY'))
    await until(() => messages.includes('HOLD'))
    expect(messages.filter((message) => message === 'HOLD')).toHaveLength(1)
    let ends = 0
    const unsubscribe = bridge.onEnded(() => { ends++ })
    peer.stdin.write('end\n')
    await until(() => ends === 1)
    const args = ["D:\\Σειρές\\It's a show & $episode.mkv", '/play', '/sub', 'D:\\Υπότιτλοι\\ένα.el.srt', '/start', '754000']
    await bridge.load(args)
    await until(() => messages.some((message) => message.startsWith('OPEN:')))
    const payload = Buffer.from(messages.find((message) => message.startsWith('OPEN:'))!.slice(5), 'base64')
    expect(payload.readUInt32LE(0)).toBe(args.length)
    expect(payload.subarray(4).toString('utf16le').split('\0').slice(0, -1)).toEqual(args)
    unsubscribe()
    peer.stdin.write('end\n')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(ends).toBe(1)
    peer.kill()
    bridge.close()
    await expect(bridge.load(args)).rejects.toThrow('unavailable')
  }, 25_000)
})
