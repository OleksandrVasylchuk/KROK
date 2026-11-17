package app.krok.mobile;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Apply the post-splash theme before AppCompat creates the activity window.
        SplashScreen.installSplashScreen(this);
        EdgeToEdge.enable(this);
        registerPlugin(KrokVoicePlugin.class);
        registerPlugin(KrokSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
