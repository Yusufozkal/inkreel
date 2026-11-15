package com.karevo.studio;

/** Executes the production token guard on a JVM; no Android framework mocks. */
public final class CloseRequestCheck {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        CloseRequest guard = new CloseRequest();
        int first = guard.begin();
        require(first > 0 && guard.matches(first), "Back must acquire one save request");
        require(guard.begin() == 0, "Repeated Back must not overlap saves");
        require(guard.complete(first), "Failed save can cancel the close request");
        require(!guard.matches(first) && !guard.complete(first), "Canceled save must not close later");
        int retry = guard.begin();
        require(retry > first && !guard.complete(first), "Late save and timeout callbacks must not cancel a newer Back request");
        require(guard.matches(retry) && guard.complete(retry), "Successful retry must remain usable");
        int paused = guard.begin();
        guard.reset();
        require(!guard.matches(paused), "Resuming the editor must cancel an obsolete close prompt");
        int resumed = guard.begin();
        require(resumed > paused && !guard.complete(paused), "A callback from before resume cannot close the resumed editor");
        require(guard.complete(resumed), "The resumed editor can save and close normally");
        require(!guard.matches(0) && !guard.complete(-1), "Malformed or missing request identities must not close the editor");
        System.out.println("Production Android close-request correlation checks passed (JVM; no device UI execution).");
    }
}
