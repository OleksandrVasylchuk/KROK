package app.krok.mobile;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Uses the selected Android speech engine. No OpenAI audio request or audio files. */
@CapacitorPlugin(name = "KrokSpeech")
public class KrokSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Locale ukrainian = Locale.forLanguageTag("uk-UA");
    private final List<Runnable> waiting = new ArrayList<>();
    private TextToSpeech engine;
    private boolean ready = false, initializing = false, destroyed = false;
    private PluginCall activeCall;
    private String lastUtterance;
    private int generation = 0;
    private int initializationGeneration = 0;
    private Runnable deadline;
    private Runnable initializationDeadline;

    private void ensureEngine(Runnable next) {
        if (destroyed) { next.run(); return; }
        if (ready) { next.run(); return; }
        waiting.add(next);
        if (initializing) return;
        initializing = true;
        final int initialization = ++initializationGeneration;
        initializationDeadline = () -> {
            if (!initializing || initializationGeneration != initialization) return;
            initializing = false; ready = false; initializationGeneration++;
            if (engine != null) { engine.shutdown(); engine = null; }
            drainWaiting();
        };
        main.postDelayed(initializationDeadline, 10000);
        try {
            if (engine != null) engine.shutdown();
            engine = new TextToSpeech(getContext(), result -> main.post(() -> {
                if (initializationGeneration != initialization || destroyed) return;
                if (initializationDeadline != null) main.removeCallbacks(initializationDeadline);
                initializing = false;
                ready = result == TextToSpeech.SUCCESS && !destroyed;
                if (ready) {
                    engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String id) { }
                        @Override public void onDone(String id) { main.post(() -> { if (id != null && id.equals(lastUtterance)) finish(true, null); }); }
                        @Override public void onError(String id) { speechError(id); }
                        @Override public void onError(String id, int code) { speechError(id); }
                        @Override public void onStop(String id, boolean interrupted) { main.post(() -> { if (id != null && id.equals(lastUtterance)) finish(false, null); }); }
                    });
                }
                drainWaiting();
            }));
        } catch (Exception error) { if (initializationDeadline != null) main.removeCallbacks(initializationDeadline); initializing = false; ready = false; drainWaiting(); }
    }

    private void drainWaiting() {
        List<Runnable> callbacks = new ArrayList<>(waiting);
        waiting.clear();
        for (Runnable callback : callbacks) callback.run();
    }

    private void speechError(String id) {
        main.post(() -> { if (activeCall != null && id != null && id.startsWith("krok-" + generation + "-")) finish(false, "failed"); });
    }

    private boolean languageAvailable() {
        return ready && engine != null && engine.isLanguageAvailable(ukrainian) >= TextToSpeech.LANG_AVAILABLE;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        main.post(() -> ensureEngine(() -> {
            JSObject result = new JSObject();
            result.put("available", ready);
            result.put("languageAvailable", languageAvailable());
            call.resolve(result);
        }));
    }

    @PluginMethod
    public void speak(PluginCall call) {
        main.post(() -> {
            final int requestedGeneration = generation;
            ensureEngine(() -> {
                if (destroyed || requestedGeneration != generation) { JSObject cancelled = new JSObject(); cancelled.put("completed", false); call.resolve(cancelled); return; }
                if (!ready) { call.reject("Speech engine is unavailable", "unsupported"); return; }
                if (activeCall != null) { call.reject("Speech is already active", "failed"); return; }
                String text = call.getString("text", "").trim();
                if (text.isEmpty() || text.length() > 6000) { call.reject("Invalid speech text", "failed"); return; }
                if (!languageAvailable() || engine.setLanguage(ukrainian) < TextToSpeech.LANG_AVAILABLE) { call.reject("Ukrainian voice is not installed", "language"); return; }
                engine.setSpeechRate(1.0f);
                activeCall = call;
                final int token = ++generation;
                int max = Math.min(3500, TextToSpeech.getMaxSpeechInputLength() - 1);
                int chunks = (text.length() + max - 1) / max;
                lastUtterance = "krok-" + token + "-" + (chunks - 1);
                for (int index = 0; index < chunks; index++) {
                    String part = text.substring(index * max, Math.min(text.length(), (index + 1) * max));
                    int result = engine.speak(part, index == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, new Bundle(), "krok-" + token + "-" + index);
                    if (result == TextToSpeech.ERROR) { finish(false, "failed"); return; }
                }
                deadline = () -> { if (generation == token && activeCall == call) finish(false, "timeout"); };
                main.postDelayed(deadline, 180000);
            });
        });
    }

    private void finish(boolean completed, String error) {
        PluginCall call = activeCall;
        activeCall = null; lastUtterance = null; generation++;
        if (deadline != null) main.removeCallbacks(deadline);
        deadline = null;
        if (!completed && engine != null) engine.stop();
        if (call == null) return;
        if (error != null) call.reject("Speech output failed", error);
        else { JSObject result = new JSObject(); result.put("completed", completed); call.resolve(result); }
    }

    @PluginMethod
    public void stop(PluginCall call) { main.post(() -> { finish(false, null); call.resolve(); }); }

    @Override
    protected void handleOnPause() { main.post(() -> finish(false, null)); }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true; ready = false; finish(false, null); drainWaiting();
            initializationGeneration++;
            if (initializationDeadline != null) main.removeCallbacks(initializationDeadline);
            if (engine != null) { engine.shutdown(); engine = null; }
        });
    }
}
