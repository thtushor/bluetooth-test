
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  NativeModules,
  NativeEventEmitter,
  FlatList,
  PermissionsAndroid,
  Platform,
  Alert,
  TextInput,
  ActivityIndicator,
  SectionList,
  Dimensions,
  SafeAreaView,
  Image,
  BackHandler,
  ScrollView,
  RefreshControl
} from 'react-native';
import { WebView } from 'react-native-webview';
import { formatDataForPrinter } from './utils/PrinterService';
import { byteArrayToBase64 } from './utils/Base64';

const { BluetoothModule } = NativeModules;
const eventEmitter = BluetoothModule ? new NativeEventEmitter(BluetoothModule) : {
  addListener: () => ({ remove: () => { } }),
  removeAllListeners: () => { },
};

const WEB_APP_URL = 'https://glorypos.com'; // Adjust if needed

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [isAppReady, setIsAppReady] = useState(false);
  const [currentScreen, setCurrentScreen] = useState('webview'); // 'webview' | 'bluetooth'
  const [printData, setPrintData] = useState(null);
  const [printType, setPrintType] = useState(null); // 'INVOICE' | 'KOT' | 'BARCODE'

  // Bluetooth State
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const webViewRef = useRef(null);
  const canGoBack = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const reloadWebView = () => {
    if (webViewRef.current) webViewRef.current.reload();
  };

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    reloadWebView();
    // Fallback in case onLoadEnd doesn't fire immediately
    setTimeout(() => {
      setRefreshing(false);
    }, 2000);
  }, []);

  useEffect(() => {
    const prepare = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        console.warn(e);
      } finally {
        setIsAppReady(true);
        await SplashScreen.hideAsync();
      }
    };
    prepare();
  }, []);

  // Setup Listeners
  useEffect(() => {
    if (!BluetoothModule) return;

    // Initial permissions and load
    if (Platform.OS === 'android') {
      requestPermissions();
    }

    // Simulate loading process


    fetchPairedDevices();

    const deviceFoundListener = eventEmitter.addListener('DeviceFound', (device) => {
      setScannedDevices((prev) => {
        if (!prev.find(d => d.address === device.address)) return [...prev, device];
        return prev;
      });
    });

    return () => {
      deviceFoundListener.remove();
    };
  }, []);

  // Back handler for Android
  useEffect(() => {
    const onBackPress = () => {
      if (canGoBack.current && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress
    );
    return () => backHandler.remove();
  }, []);

  const requestPermissions = async () => {
    try {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
      }
    } catch (err) {
      console.warn(err);
    }
  };

  const fetchPairedDevices = async () => {
    try {
      const devices = await BluetoothModule.getPairedDevices();
      setPairedDevices(devices);
    } catch (e) {
      console.warn("Fetch paired failed", e);
    }
  };

  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      // Expected format: { type: 'PRINT_INVOICE' | 'PRINT_KOT' | 'PRINT_BARCODE' | 'PRINT_BARCODE_LABEL', payload: object }

      if (data.type && data.type.startsWith('PRINT_')) {
        const type = data.type.replace('PRINT_', '');
        setPrintType(type);
        setPrintData(data.payload);
        setCurrentScreen('bluetooth');
        const alertMsg = connectedDevice
          ? `Received ${type} print request.\nConnected to: ${connectedDevice.name || 'Device'}`
          : `Received ${type} print request. Please select a printer.`;
        Alert.alert("Print Request", alertMsg);
      }
    } catch (e) {
      console.error("Failed to parse webview message", e);
    }
  };

  // --- Bluetooth Logic ---

  const startScan = async () => {
    try {
      setScannedDevices([]);
      setScanning(true);
      await BluetoothModule.startScan();
    } catch (e) {
      Alert.alert("Scan Error", e.message);
      setScanning(false);
    }
  };

  const stopScan = async () => {
    try {
      await BluetoothModule.stopScan();
      setScanning(false);
    } catch (e) { console.warn(e); }
  };

  const connectToDevice = async (device) => {
    try {
      if (scanning) await stopScan();
      Alert.alert("Connecting", `Connecting to ${device.name || "device"}...`);
      const res = await BluetoothModule.connect(device.address);
      setConnectedDevice(device);
      Alert.alert("Connected", res);
    } catch (e) {
      Alert.alert("Connection Failed", e.message);
    }
  };

  const pairDevice = async (device) => {
    try {
      if (scanning) await stopScan();
      await BluetoothModule.pairDevice(device.address);
      Alert.alert("Pairing", "Pairing initiated. Please check device.");
    } catch (e) {
      Alert.alert("Pairing Failed", e.message);
    }
  };

  const disconnect = async () => {
    try {
      await BluetoothModule.disconnect();
      setConnectedDevice(null);
    } catch (e) { console.warn(e); }
  };

  // --- Printing Logic ---

  const handlePrint = async () => {
    if (!connectedDevice) {
      Alert.alert("No Printer", "Please connect to a bluetooth printer first.");
      return;
    }
    if (!printData) {
      Alert.alert("No Data", "No print data found.");
      return;
    }

    try {
      const commands = formatDataForPrinter(printType, printData);
      if (commands.length === 0) {
        Alert.alert("Error", "Could not format data for printing.");
        return;
      }

      const base64Data = byteArrayToBase64(commands);
      await BluetoothModule.printRawData(base64Data);

      Alert.alert("Success", "Print command sent!", [
        { text: "Back to Web", onPress: () => setCurrentScreen('webview') },
        { text: "Stay", style: "cancel" }
      ]);
    } catch (e) {
      Alert.alert("Print Error", e.message);
    }
  };

  // --- Render ---

  const renderDeviceItem = ({ item }) => {
    const isPaired = pairedDevices.some(d => d.address === item.address) || item.bonded;
    const isConnected = connectedDevice && connectedDevice.address === item.address;

    return (
      <View style={[styles.deviceItem, isConnected && styles.connectedDeviceItem]}>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name || "Unknown Device"}</Text>
          <Text style={styles.deviceAddress}>{item.address}</Text>
          {isPaired && <Text style={styles.pairedLabel}>Paired</Text>}
          {isConnected && <Text style={styles.connectedLabel}>Connected</Text>}
        </View>
        <View style={styles.deviceActions}>
          {!isPaired && !isConnected && (
            <TouchableOpacity style={[styles.actionButton, styles.pairButton]} onPress={() => pairDevice(item)}>
              <Text style={styles.actionButtonText}>Pair</Text>
            </TouchableOpacity>
          )}
          {isConnected ? (
            <TouchableOpacity style={[styles.actionButton, styles.disconnectButton]} onPress={disconnect}>
              <Text style={styles.actionButtonText}>Disconnect</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.actionButton, styles.connectButton]} onPress={() => connectToDevice(item)}>
              <Text style={styles.actionButtonText}>Connect</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (!isAppReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
        <Image
          source={require('./assets/splash.jpg')}
          style={{ width: '100%', height: '100%', resizeMode: 'cover', position: 'absolute' }}
        />
        <View style={{ position: 'absolute', bottom: 120, alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={{ marginTop: 10, fontSize: 16, fontWeight: 'bold', color: '#ffffff' }}>Processing...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>

      {/* WebView Screen - Always mounted to preserve state */}
      <View style={[styles.webViewContainer, { display: currentScreen === 'webview' ? 'flex' : 'none' }]}>
        <SafeAreaView style={{ flex: 1 }}>
          <StatusBar style="dark" />

          {/* Premium Top Bar */}
          <View style={styles.topBar}>
            <Text style={styles.brandTitle}>GloryPOS</Text>
            <TouchableOpacity
              style={styles.topBarReloadButton}
              onPress={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#007bff" />
              ) : (
                <Text style={{ fontSize: 24, color: '#007bff', fontWeight: 'bold', marginTop: -4 }}>↻</Text>
              )}
            </TouchableOpacity>
          </View>

          <WebView
            ref={webViewRef}
            source={{ uri: WEB_APP_URL }}
            style={styles.webview}
            onMessage={handleWebViewMessage}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            onLoadEnd={() => setRefreshing(false)}
            onNavigationStateChange={(navState) => {
              canGoBack.current = navState.canGoBack;
            }}
            onShouldStartLoadWithRequest={(request) => {
              // Always open all links inside the WebView itself
              if (
                request.url.startsWith("https") ||
                request.url.startsWith("http")
              ) {
                return true;
              }
              return false;
            }}
            renderLoading={() => (
              <ActivityIndicator
                size="large"
                color="#000"
                style={styles.loadingIndicator}
              />
            )}
          />

          {Platform.OS === "android" && (
            <View
              style={{
                height: 10,
                backgroundColor: "#fff",
              }}
            />
          )}
        </SafeAreaView>
      </View>

      {/* Bluetooth Screen */}
      {currentScreen === 'bluetooth' && (
        <SafeAreaView style={[styles.container, { flex: 1 }]}>
          <StatusBar style="auto" />
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('webview')}>
              <Text style={styles.backButton}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Printer Manager</Text>
            <TouchableOpacity onPress={fetchPairedDevices}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          </View>

          {/* Print Action Area */}
          {printData && (
            <View style={styles.printActionArea}>
              <Text style={styles.printActionTitle}>Ready to Print: {printType}</Text>
              <TouchableOpacity style={styles.bigPrintButton} onPress={handlePrint}>
                <Text style={styles.bigPrintButtonText}>PRINT {printType}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.button, scanning ? styles.stopButton : styles.scanButton]}
              onPress={scanning ? stopScan : startScan}
            >
              <Text style={styles.buttonText}>{scanning ? "Stop Scan" : "Scan New Devices"}</Text>
            </TouchableOpacity>
            {scanning && <ActivityIndicator size="small" color="#007bff" style={{ marginLeft: 10 }} />}
          </View>

          <SectionList
            sections={[
              { title: "Paired Devices", data: pairedDevices },
              { title: "Available Devices", data: scannedDevices.filter(d => !pairedDevices.find(pd => pd.address === d.address)) }
            ]}
            renderItem={renderDeviceItem}
            renderSectionHeader={({ section: { title, data } }) => (
              data.length > 0 ? <Text style={styles.sectionHeader}>{title}</Text> : null
            )}
            keyExtractor={item => item.address}
            style={styles.list}
          />
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: Platform.OS === 'android' ? 30 : 0,
  },
  header: {
    padding: 15,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: { fontSize: 18, fontWeight: 'bold' },
  backButton: { fontSize: 16, color: '#007bff' },
  refreshText: { fontSize: 24, fontWeight: 'bold', color: '#007bff' },
  tabBar: {
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#fff',
    position: 'relative', // Ensure floating button works
  },
  topBarReloadButton: {
    width: 40,
    height: 40,
    paddingTop: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
  },
  topBar: {
    height: 60,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    zIndex: 10,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
  },
  brandSubtitle: {
    fontSize: 10,
    color: '#666',
    fontWeight: '600',
    marginTop: -2,
  },
  printerCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  printerIcon: {
    fontSize: 18,
  },
  webview: {
    flex: 1,
  },
  loadingIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -20,
  },
  printActionArea: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: '#bbdefb'
  },
  printActionTitle: { fontSize: 16, marginBottom: 10, fontWeight: 'bold', color: '#0d47a1' },
  bigPrintButton: {
    backgroundColor: '#007bff',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 25,
    elevation: 3
  },
  bigPrintButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  controls: { padding: 15, flexDirection: 'row', alignItems: 'center' },
  button: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center' },
  scanButton: { backgroundColor: '#28a745' },
  stopButton: { backgroundColor: '#dc3545' },
  buttonText: { color: '#fff', fontWeight: '600' },
  list: { flex: 1, paddingHorizontal: 15 },
  sectionHeader: { fontSize: 14, fontWeight: 'bold', backgroundColor: '#e9ecef', padding: 8, marginTop: 10, borderRadius: 4 },
  deviceItem: { backgroundColor: '#fff', padding: 15, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#eee', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  connectedDeviceItem: { borderColor: '#007bff', backgroundColor: '#f0f8ff' },
  deviceInfo: { flex: 1 },
  deviceName: { fontSize: 16, fontWeight: 'bold' },
  deviceAddress: { fontSize: 12, color: '#666' },
  pairedLabel: { fontSize: 10, color: '#28a745', fontWeight: 'bold' },
  connectedLabel: { fontSize: 10, color: '#007bff', fontWeight: 'bold' },
  deviceActions: { flexDirection: 'row', gap: 10 },
  actionButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  pairButton: { backgroundColor: '#ffc107' },
  connectButton: { backgroundColor: '#17a2b8' },
  disconnectButton: { backgroundColor: '#6c757d' },
  actionButtonText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
});
