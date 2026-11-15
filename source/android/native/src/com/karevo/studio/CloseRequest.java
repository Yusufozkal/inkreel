package com.karevo.studio;

/** Correlates asynchronous saves and timeout dialogs with one Back request. */
final class CloseRequest {
    private int sequence;
    private int active;

    int begin() {
        if (active != 0) return 0;
        sequence = sequence == Integer.MAX_VALUE ? 1 : sequence + 1;
        active = sequence;
        return active;
    }

    boolean matches(int token) { return token > 0 && token == active; }

    boolean complete(int token) {
        if (!matches(token)) return false;
        active = 0;
        return true;
    }

    void reset() { active = 0; }
}
