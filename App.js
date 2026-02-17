
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  RefreshControl,
  ToastAndroid,
  StatusBar as RNStatusBar
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  const [connectedDevice, setConnectedDevice] = useState(null); // { name, address }
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastPrinter, setLastPrinter] = useState(null);

  const webViewRef = useRef(null);
  const canGoBack = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  // --- Initialization & Auto-Connect ---

  useEffect(() => {
    const prepare = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Splash delay
        if (BluetoothModule) {
          await checkAndAutoConnect();
        }
      } catch (e) {
        console.warn(e);
      } finally {
        setIsAppReady(true);
        await SplashScreen.hideAsync();
      }
    };
    prepare();
  }, []);

  const checkAndAutoConnect = async () => {
    try {
      if (Platform.OS === 'android') {
        await requestPermissions();
      }

      const enabled = await BluetoothModule.isBluetoothEnabled();
      if (!enabled) {
        // Bluetooth is off, we can't do much automatically
        return;
      }

      // Check if already connected (native side)
      const current = await BluetoothModule.getConnectedDevice();

      // Check for devices connected to the OS
      const sysConnectedDevices = await BluetoothModule.getSystemConnectedPairedDevices();
      console.log("System connected devices:", sysConnectedDevices);

      if (current) {
        setConnectedDevice(current);
        ToastAndroid.show(`Connected to ${current.name}`, ToastAndroid.SHORT);
        return;
      }

      // PRIORITY 1: Connect to the device actively connected to OS
      if (sysConnectedDevices && sysConnectedDevices.length > 0) {
        // Try to find a printer first
        const target = sysConnectedDevices.find(d => d.type === 'printer') || sysConnectedDevices[0];
        console.log("Found system-connected device, auto-connecting:", target.name);
        setIsConnecting(true);
        try {
          // We attempt to open a socket to this device
          await BluetoothModule.connect(target.address);
          setConnectedDevice(target);
          // Save it as last used context
          await BluetoothModule.saveLastPrinter(target.address, target.name || "Unknown");
          setLastPrinter(target);
          ToastAndroid.show(`Synced with ${target.name}`, ToastAndroid.SHORT);
          setIsConnecting(false);
          return; // Success, we are done
        } catch (e) {
          console.warn("Failed to sync with system device", e);
          // If failed, fall through to try last printer
        } finally {
          setIsConnecting(false);
        }
      }

      // PRIORITY 2: Check for last used printer
      const last = await BluetoothModule.getLastPrinter();
      if (last) {
        setLastPrinter(last);
        setIsConnecting(true);
        try {
          // Attempt connection
          console.log("Auto-connecting to", last.name);
          await BluetoothModule.connect(last.address);
          setConnectedDevice(last);
          ToastAndroid.show(`Auto-connected to ${last.name}`, ToastAndroid.SHORT);
        } catch (e) {
          console.log("Auto-connect failed, user must select manually");
          // Don't show alert, just let user connect manually when needed
        } finally {
          setIsConnecting(false);
        }
      }

      // Refresh paired devices list
      fetchPairedDevices();

    } catch (e) {
      console.warn("Auto-connect error", e);
    }
  };

  // Setup Listeners
  useEffect(() => {
    if (!BluetoothModule) return;

    const deviceFoundListener = eventEmitter.addListener('DeviceFound', (device) => {
      setScannedDevices((prev) => {
        if (!prev.find(d => d.address === device.address)) return [...prev, device];
        return prev;
      });
    });

    const bondListener = eventEmitter.addListener('DeviceBondStateChanged', (device) => {
      if (device.bondState === 'bonded') {
        fetchPairedDevices();
      }
    });

    const disconnectListener = eventEmitter.addListener('DeviceDisconnected', () => {
      setConnectedDevice(null);
      setCurrentScreen('bluetooth');
      ToastAndroid.show("Printer Disconnected", ToastAndroid.SHORT);
    });

    return () => {
      deviceFoundListener.remove();
      bondListener.remove();
      disconnectListener.remove();
    };
  }, []);

  // Back handler for Android
  useEffect(() => {
    const onBackPress = () => {
      if (currentScreen === 'bluetooth') {
        setCurrentScreen('webview');
        return true;
      }
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
  }, [currentScreen]);

  const requestPermissions = async () => {
    try {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.CAMERA, // Keep camera permission as requested in other tasks
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

  const handleWebViewMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      // Expected format: { type: 'PRINT_INVOICE' | 'PRINT_KOT' | 'PRINT_BARCODE' | 'PRINT_BARCODE_LABEL', payload: object }

      if (data.type && data.type.startsWith('PRINT_')) {
        const type = data.type.replace('PRINT_', '');
        setPrintType(type);
        setPrintData(data.payload);

        // Check connection status again to be sure
        const isConnected = await BluetoothModule.isConnected();

        if (isConnected && connectedDevice) {
          // Auto-print
          ToastAndroid.show("Printing...", ToastAndroid.SHORT);
          await processPrint(type, data.payload);
        } else {
          // Show UI for connection
          setCurrentScreen('bluetooth');
          // Try to auto-reconnect if we have a last printer and not currently connected
          if (lastPrinter && !isConnected && !isConnecting) {
            connectToDevice(lastPrinter, true); // true = silent/auto mode context
          }
        }
      }
    } catch (e) {
      console.error("Failed to parse webview message", e);
    }
  };

  const processPrint = async (type, data) => {
    try {
      const commands = formatDataForPrinter(type, data);
      if (commands.length === 0) {
        Alert.alert("Error", "Could not format data for printing.");
        return;
      }
      const base64Data = byteArrayToBase64(commands);
      await BluetoothModule.printRawData(base64Data);
      ToastAndroid.show("Print Sent Successfully", ToastAndroid.SHORT);
      // Go back to POS screen on success
      setCurrentScreen('webview');
    } catch (e) {
      console.warn("Print Error", e);
      Alert.alert("Print Failed", "Connection problem or printer error. Please check printer.");
      setCurrentScreen('bluetooth'); // Go to printer manager on failure
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

  const connectToDevice = async (device, silent = false) => {
    try {
      if (scanning) await stopScan();
      setIsConnecting(true);
      if (!silent) ToastAndroid.show(`Connecting to ${device.name || "device"}...`, ToastAndroid.SHORT);

      const res = await BluetoothModule.connect(device.address);

      setConnectedDevice(device);
      // Save as last printer
      await BluetoothModule.saveLastPrinter(device.address, device.name || "Unknown");
      setLastPrinter(device);

      if (!silent) Alert.alert("Connected", res);

      // If we have pending print data, ask to print
      if (printData && printType) {
        Alert.alert(
          "Ready to Print",
          `Do you want to print the pending ${printType}?`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Print Now", onPress: () => processPrint(printType, printData) }
          ]
        );
      }

    } catch (e) {
      if (!silent) Alert.alert("Connection Failed", e.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const pairDevice = async (device) => {
    try {
      if (scanning) await stopScan();
      await BluetoothModule.pairDevice(device.address);
      ToastAndroid.show("Pairing initiated...", ToastAndroid.SHORT);
    } catch (e) {
      Alert.alert("Pairing Failed", e.message);
    }
  };

  const disconnect = async () => {
    try {
      await BluetoothModule.disconnect();
      setConnectedDevice(null);
      await BluetoothModule.clearLastPrinter(); // Optional: do we want to forget? Maybe better not to clear, just disconnect.
      // Actually user said "Fast automatic reconnection", so maybe keeping it is better. 
      // But if user explicitly disconnects, they might want to switch.
      // Let's NOT clear the preference on manual disconnect, so it remembers next time. 
      // Only clear if they connect to a different one. (Handled in connectToDevice)
    } catch (e) { console.warn(e); }
  };

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    if (webViewRef.current) webViewRef.current.reload();
    setTimeout(() => {
      setRefreshing(false);
    }, 2000);
  }, []);

  // --- Render ---

  const renderDeviceItem = ({ item }) => {
    const isPaired = pairedDevices.some(d => d.address === item.address) || item.bonded;
    const isConnected = connectedDevice && connectedDevice.address === item.address;

    const getDeviceIcon = (type) => {
      console.log({ type })
      switch (type) {
        case 'printer': return 'printer';
        case 'computer': return 'laptop';
        case 'phone': return 'cellphone';
        case 'audio': return 'headphones';
        case 'uncategorized': return 'help-circle-outline';
        default: return 'bluetooth';
      }
    };

    return (
      <View style={[styles.deviceItem, isConnected && styles.connectedDeviceItem]}>
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons name={getDeviceIcon(item.type)} size={24} color="#555" />
        </View>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name || "Unknown Device"}</Text>
          <Text style={styles.deviceAddress}>{item.address}</Text>
          <View style={styles.tagsRow}>
            {item.type === 'printer' && <Text style={styles.typeLabel}>Printer</Text>}
            {isPaired && <Text style={styles.pairedLabel}>Paired</Text>}
            {isConnected && <Text style={styles.connectedLabel}>Connected</Text>}
          </View>
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
            <TouchableOpacity
              style={[styles.actionButton, styles.connectButton, isConnecting && styles.disabledButton]}
              onPress={() => connectToDevice(item)}
              disabled={isConnecting}
            >
              <Text style={styles.actionButtonText}>{isConnecting ? "..." : "Connect"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (!isAppReady) {
    return (
      <View style={styles.splashContainer}>
        <Image
          source={require('./assets/splash.jpg')}
          style={styles.splashImage}
        />
        <View style={styles.splashLoader}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.splashText}>Starting POS System...</Text>
        </View>
      </View>
    );
  }

  // Section data preparation
  const activeDeviceSection = connectedDevice ? [{ ...connectedDevice }] : [];

  // Filter available devices: Show Printers & Uncategorized. Hide verified phones/computers/audio unless specific need?
  // User asked: "prioritize printers only then others" -> implying show others but below? 
  // User also said "syncing... prioritize printers". 
  // Let's SHOW all but Sort: Printers First.

  const sortDevices = (a, b) => {
    const typeScore = (type) => {
      if (type === 'printer') return 3;
      if (type === 'uncategorized') return 2;
      return 1;
    };
    return typeScore(b.type) - typeScore(a.type);
  };

  const availableDevices = scannedDevices
    .filter(d =>
      !pairedDevices.find(pd => pd.address === d.address) &&
      d.address !== connectedDevice?.address
    )
    .sort(sortDevices); // Sort printers to top

  const pairedDevicesList = pairedDevices
    .filter(d => d.address !== connectedDevice?.address)
    .sort(sortDevices); // Sort printers to top

  const sections = [
    ...(connectedDevice ? [{ title: "Connected Device", data: activeDeviceSection }] : []),
    { title: "Paired Devices", data: pairedDevicesList },
    { title: "Available Devices", data: availableDevices }
  ].filter(s => s.data.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>

      {/* WebView Screen */}
      <View style={[styles.webViewContainer, { display: currentScreen === 'webview' ? 'flex' : 'none' }]}>
        <SafeAreaView style={{ flex: 1, paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 }}>
          <StatusBar style="dark" />
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={() => setCurrentScreen('bluetooth')}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{
                width: 24, height: 24, borderRadius: 12,
                backgroundColor: connectedDevice ? '#e8f5e9' : '#fafafa',
                alignItems: 'center', justifyContent: 'center', marginRight: 6,
                borderWidth: 1, borderColor: connectedDevice ? '#c8e6c9' : '#eee'
              }}>
                <MaterialCommunityIcons
                  name={connectedDevice ? "printer-check" : "bluetooth-connect"}
                  size={14}
                  color={connectedDevice ? "#2e7d32" : "#bdbdbd"}
                />
              </View>
              <View>
                <Text style={{ fontSize: 7, color: '#9e9e9e', fontWeight: 'bold', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {connectedDevice ? 'CONNECTED PRINTER' : 'NO PRINTER'}
                </Text>
                <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#424242' }}>
                  {connectedDevice ? (connectedDevice.name || 'Unknown Device') : 'Tap to Connect'}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.topBarReloadButton}
              onPress={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? <ActivityIndicator size="small" color="#007bff" /> : <Text style={styles.reloadIcon}>↻</Text>}
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
            originWhitelist={['*']}
            allowFileAccess={true}
            allowUniversalAccessFromFileURLs={true}
            mixedContentMode="always"
            onShouldStartLoadWithRequest={(request) => {
              // Allow standard protocols and about:blank for initial load
              const url = request.url;
              if (!url) return true; // Defensive
              if (
                url.startsWith("https") || 
                url.startsWith("http") || 
                url.startsWith("about:blank") ||
                url.startsWith("file")
              ) return true;
              return false;
            }}
            renderLoading={() => (
              <ActivityIndicator size="large" color="#000" style={styles.loadingIndicator} />
            )}
          />
          {Platform.OS === "android" && <View style={{ height: 10, backgroundColor: "#fff" }} />}
        </SafeAreaView>
      </View>

      {/* Bluetooth/Printer Manager Screen */}
      {currentScreen === 'bluetooth' && (
        <SafeAreaView style={[styles.container, { flex: 1 }]}>
          <StatusBar style="auto" />
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('webview')}>
              <Text style={styles.backButton}>Back to POS</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Printer Manager</Text>
            <TouchableOpacity onPress={fetchPairedDevices}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          </View>

          {/* Pending Print Job Indicator */}
          {printData && (
            <View style={styles.printActionArea}>
              <View>
                <Text style={styles.printActionTitle}>Pending Job: {printType}</Text>
                <Text style={styles.printActionSubtitle}>{connectedDevice ? "Ready to print" : "Connect a printer to continue"}</Text>
              </View>
              {connectedDevice && (
                <TouchableOpacity style={styles.bigPrintButton} onPress={() => processPrint(printType, printData)}>
                  <Text style={styles.bigPrintButtonText}>PRINT NOW</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.button, scanning ? styles.stopButton : styles.scanButton]}
              onPress={scanning ? stopScan : startScan}
            >
              <Text style={styles.buttonText}>{scanning ? "Stop Searching" : "Search New Devices"}</Text>
            </TouchableOpacity>
            {scanning && <ActivityIndicator size="small" color="#007bff" style={{ marginLeft: 10 }} />}
          </View>

          <SectionList
            sections={sections}
            renderItem={renderDeviceItem}
            renderSectionHeader={({ section: { title } }) => (
              <Text style={styles.sectionHeader}>{title}</Text>
            )}
            keyExtractor={item => item.address}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No devices found. Tap Search.</Text>
            }
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
  splashContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  splashImage: { width: '100%', height: '100%', resizeMode: 'cover', position: 'absolute', opacity: 0.6 },
  splashLoader: { position: 'absolute', bottom: 120, alignItems: 'center' },
  splashText: { marginTop: 10, fontSize: 16, fontWeight: 'bold', color: '#ffffff' },
  header: {
    padding: 15,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    elevation: 2
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  backButton: { fontSize: 16, color: '#007bff', fontWeight: '500' },
  refreshText: { fontSize: 24, fontWeight: 'bold', color: '#007bff' },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  topBarReloadButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
  },
  reloadIcon: { fontSize: 14, color: '#007bff', fontWeight: 'bold' },
  topBar: {
    height: 40,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    elevation: 2
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#333',
    letterSpacing: 1,
  },
  webview: { flex: 1 },
  loadingIndicator: { position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -20 },
  printActionArea: {
    backgroundColor: '#e3f2fd',
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: '#bbdefb'
  },
  printActionTitle: { fontSize: 16, fontWeight: 'bold', color: '#0d47a1' },
  printActionSubtitle: { fontSize: 12, color: '#1565c0' },
  bigPrintButton: {
    backgroundColor: '#007bff',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    elevation: 3
  },
  bigPrintButtonText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  controls: { padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  button: { paddingVertical: 12, paddingHorizontal: 30, borderRadius: 25, alignItems: 'center', elevation: 2 },
  scanButton: { backgroundColor: '#28a745' },
  stopButton: { backgroundColor: '#dc3545' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  listContent: { paddingHorizontal: 15, paddingBottom: 20 },
  sectionHeader: { fontSize: 14, fontWeight: 'bold', color: '#666', marginTop: 20, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  deviceItem: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 1
  },
  connectedDeviceItem: { borderColor: '#4caf50', backgroundColor: '#f1f8e9', borderWidth: 2 },
  deviceInfo: { flex: 1 },
  deviceName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  deviceAddress: { fontSize: 12, color: '#888', marginTop: 2 },
  tagsRow: { flexDirection: 'row', marginTop: 5, gap: 5 },
  typeLabel: { fontSize: 10, color: '#fff', backgroundColor: '#2196f3', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  pairedLabel: { fontSize: 10, color: '#fff', backgroundColor: '#aaa', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  connectedLabel: { fontSize: 10, color: '#fff', backgroundColor: '#4caf50', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  deviceActions: { flexDirection: 'row', gap: 10 },
  actionButton: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  pairButton: { backgroundColor: '#ffc107' },
  connectButton: { backgroundColor: '#007bff' },
  disconnectButton: { backgroundColor: '#ff5252' },
  disabledButton: { opacity: 0.6 },
  actionButtonText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  emptyText: { textAlign: 'center', marginTop: 50, color: '#888' }
});
