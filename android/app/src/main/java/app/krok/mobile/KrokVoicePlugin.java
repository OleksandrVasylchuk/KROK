package app.krok.mobile;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/** One short, explicitly requested dictation session. No audio files or KROK audio upload. */
@CapacitorPlugin(name = "KrokVoice", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class KrokVoicePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall activeCall;
    private int generation = 0;
    private Runnable deadline;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        main.post(() -> {
            if (activeCall != null) { call.reject("Speech recognition is already running", "busy"); return; }
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("No speech recognition service", "unsupported"); return; }
            activeCall = call;
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                requestPermissionForAlias("microphone", call, "microphonePermissionResult");
            } else begin(call);
        });
    }

    @PermissionCallback
    private void microphonePermissionResult(PluginCall call) {
        main.post(() -> {
            if (activeCall != call) return;
            if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
            else fail("permission_denied");
        });
    }

    private void state(String phase) {
        JSObject event = new JSObject();
        event.put("phase", phase);
        notifyListeners("state", event);
    }

    private void begin(PluginCall call) {
        final int token = ++generation;
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                private boolean current() { return generation == token && activeCall == call; }
                @Override public void onReadyForSpeech(Bundle params) { if (current()) state("listening"); }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float rmsdB) { }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { if (current()) state("stopping"); }
                @Override public void onPartialResults(Bundle results) { }
                @Override public void onEvent(int eventType, Bundle params) { }
                @Override public void onError(int error) {
                    if (!current()) return;
                    String code;
                    switch (error) {
                        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code = "permission_denied"; break;
                        case SpeechRecognizer.ERROR_NO_MATCH:
                        case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: code = "no_speech"; break;
                        case SpeechRecognizer.ERROR_NETWORK:
                        case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                        case SpeechRecognizer.ERROR_SERVER: code = "network"; break;
                        case SpeechRecognizer.ERROR_AUDIO: code = "audio"; break;
                        case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: code = "busy"; break;
                        case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                        case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE: code = "language"; break;
                        default: code = "recognition_failed";
                    }
                    fail(code);
                }
                @Override public void onResults(Bundle results) {
                    if (!current()) return;
                    ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
                    if (text.isEmpty()) { fail("no_speech"); return; }
                    PluginCall completed = activeCall;
                    clear();
                    JSObject result = new JSObject();
                    result.put("text", text.length() > 6000 ? text.substring(0, 6000) : text);
                    completed.resolve(result);
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "uk-UA");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            deadline = () -> { if (generation == token && activeCall != null) fail("timeout"); };
            main.postDelayed(deadline, 45000);
            recognizer.startListening(intent);
        } catch (SecurityException error) { fail("permission_denied"); }
        catch (Exception error) { fail("recognition_failed"); }
    }

    private void clear() {
        ++generation;
        activeCall = null;
        if (deadline != null) { main.removeCallbacks(deadline); deadline = null; }
        if (recognizer != null) {
            SpeechRecognizer old = recognizer;
            recognizer = null;
            try { old.cancel(); old.destroy(); } catch (Exception ignored) { }
        }
    }

    private void fail(String code) {
        PluginCall failed = activeCall;
        clear();
        if (failed != null) failed.reject("Speech recognition ended: " + code, code);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            try {
                if (recognizer != null) { state("stopping"); recognizer.stopListening(); }
                else if (activeCall != null) fail("cancelled");
                call.resolve();
            } catch (Exception error) { fail("recognition_failed"); call.resolve(); }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> { fail("cancelled"); call.resolve(); });
    }

    @Override protected void handleOnStop() {
        // Permission dialogs may pause the activity; stop only an actual capture.
        main.post(() -> { if (recognizer != null) fail("cancelled"); });
    }

    @Override protected void handleOnDestroy() {
        main.post(() -> fail("cancelled"));
    }
}
