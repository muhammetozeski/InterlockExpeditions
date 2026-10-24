using System.Diagnostics;
using InterlockExpeditions.Portal.Services;
using Microsoft.AspNetCore.Components;

namespace InterlockExpeditions.Portal.Shared;

/// <summary>One UI action boundary preserves existing work and exposes a retryable, truthful failure.</summary>
public abstract class ExpeditionPage : ComponentBase
{
    [Inject] protected ExpeditionApi Api { get; set; } = default!;
    [Inject] protected ILogger<ExpeditionPage> Logger { get; set; } = default!;
    protected bool Busy, HasError;
    protected string Status = "";
    /// <summary>Executes one complete user action; failures cannot trigger dependent success steps.</summary>
    protected async Task RunAsync(Func<Task> action)
    {
        if (Busy) return; Busy = true; HasError = false; var timer = Stopwatch.StartNew();
        try { await action(); }
        catch (Exception error)
        {
            HasError = true; Status = error is ExpeditionFailure or FormatException ? error.Message : "The connection or browser action could not be completed. Your room has not been replaced. Refresh, then retry the same control.";
            Logger.LogWarning("Expedition interface action failed; type={Type}; status={Status}", error.GetType().Name, error is ExpeditionFailure failure ? (int)failure.Status : 0);
        }
        finally { timer.Stop(); Busy = false; Logger.LogInformation("Expedition interface action finished; elapsedMs={Elapsed}", timer.Elapsed.TotalMilliseconds); }
    }
}
