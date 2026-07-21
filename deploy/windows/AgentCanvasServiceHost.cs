using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

internal sealed class AgentCanvasServiceHost : ServiceBase
{
    private readonly string installPath;
    private readonly string dataPath;
    private readonly string nodePath;
    private readonly object sync = new object();
    private Process child;
    private StreamWriter stdout;
    private StreamWriter stderr;
    private bool stopping;

    private AgentCanvasServiceHost(string serviceName, string installPath, string dataPath, string nodePath)
    {
        this.installPath = installPath;
        this.dataPath = dataPath;
        this.nodePath = nodePath;
        ServiceName = serviceName;
        CanStop = true;
        CanShutdown = true;
        AutoLog = false;
    }

    protected override void OnStart(string[] args)
    {
        Directory.CreateDirectory(dataPath);
        Directory.CreateDirectory(Path.Combine(dataPath, "logs"));
        stdout = OpenLog("agentcanvas.out.log");
        stderr = OpenLog("agentcanvas.err.log");

        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = "--import tsx src/server.ts",
            WorkingDirectory = installPath,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.EnvironmentVariables["AGENT_CANVAS_DB"] = Path.Combine(dataPath, "agent-canvas.sqlite");

        try
        {
            child = Process.Start(startInfo);
            if (child == null) throw new InvalidOperationException("Node.js did not start.");
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += OnOutput;
            child.ErrorDataReceived += OnError;
            child.Exited += OnChildExited;
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            Write(stdout, "AgentCanvas child process started with PID " + child.Id + ".");
        }
        catch (Exception error)
        {
            Write(stderr, "AgentCanvas child process failed to start: " + error);
            CloseLogs();
            throw;
        }
    }

    protected override void OnStop()
    {
        Process process;
        lock (sync)
        {
            stopping = true;
            process = child;
            child = null;
        }

        if (process != null)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill();
                    process.WaitForExit(15000);
                }
            }
            catch (Exception error)
            {
                Write(stderr, "AgentCanvas child process did not stop cleanly: " + error);
            }
            finally
            {
                process.Dispose();
            }
        }

        CloseLogs();
    }

    protected override void OnShutdown()
    {
        OnStop();
        base.OnShutdown();
    }

    private StreamWriter OpenLog(string name)
    {
        var path = Path.Combine(dataPath, "logs", name);
        return new StreamWriter(new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
        {
            AutoFlush = true
        };
    }

    private void OnOutput(object sender, DataReceivedEventArgs args)
    {
        if (args.Data != null) Write(stdout, args.Data);
    }

    private void OnError(object sender, DataReceivedEventArgs args)
    {
        if (args.Data != null) Write(stderr, args.Data);
    }

    private void OnChildExited(object sender, EventArgs args)
    {
        lock (sync)
        {
            if (stopping) return;
            stopping = true;
        }

        var process = sender as Process;
        Write(stderr, "AgentCanvas child process exited unexpectedly with code " + (process == null ? "unknown" : process.ExitCode.ToString()) + ".");
        CloseLogs();
        Environment.Exit(1);
    }

    private void CloseLogs()
    {
        lock (sync)
        {
            if (stdout != null)
            {
                stdout.Dispose();
                stdout = null;
            }
            if (stderr != null)
            {
                stderr.Dispose();
                stderr = null;
            }
        }
    }

    private static void Write(StreamWriter writer, string message)
    {
        if (writer == null) return;
        try
        {
            writer.WriteLine(DateTime.UtcNow.ToString("o") + " " + message);
        }
        catch (Exception error)
        {
            Debug.WriteLine("AgentCanvas service logging failed: " + error.Message);
        }
    }

    private static void Main(string[] args)
    {
        if (args.Length != 4)
        {
            Console.Error.WriteLine("Expected: AgentCanvasServiceHost.exe <serviceName> <installPath> <dataPath> <nodePath>");
            Environment.ExitCode = 2;
            return;
        }

        ServiceBase.Run(new AgentCanvasServiceHost(args[0], args[1], args[2], args[3]));
    }
}
