#import "RCTBluetoothModule.h"

// Define common printer service UUIDs here if needed, or scan all
// Many cheap thermal printers use these
#define ISSC_SERVICE_UUID @"49535343-FE7D-4AE5-8FA9-9FAFD205E455"
#define ISSC_CHAR_RX_UUID @"49535343-8841-43F4-A8D4-ECBE34729BB3"
#define ISSC_CHAR_TX_UUID @"49535343-1E4D-4BD9-BA61-23C647249616"

@implementation RCTBluetoothModule
{
    CBCentralManager *_centralManager;
    CBPeripheral *_connectedPeripheral;
    CBCharacteristic *_writeCharacteristic;
    NSMutableDictionary<NSString *, CBPeripheral *> *_scannedPeripherals;
    bool _hasListeners;
    RCTPromiseResolveBlock _connectResolve;
    RCTPromiseRejectBlock _connectReject;
}

RCT_EXPORT_MODULE(BluetoothModule);

- (NSArray<NSString *> *)supportedEvents
{
    return @[@"DeviceFound", @"DeviceConnected", @"DeviceDisconnected", @"Error"];
}

- (void)startObserving {
    _hasListeners = YES;
}

- (void)stopObserving {
    _hasListeners = NO;
}

- (instancetype)init
{
    self = [super init];
    if (self) {
        _scannedPeripherals = [NSMutableDictionary new];
        dispatch_queue_t queue = dispatch_queue_create("com.counterapp.bluetooth", DISPATCH_QUEUE_SERIAL);
        _centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:queue];
    }
    return self;
}

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

#pragma mark - RCT Exports

RCT_EXPORT_METHOD(startScan:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    if (_centralManager.state != CBManagerStatePoweredOn) {
        reject(@"BLUETOOTH_OFF", @"Bluetooth is not powered on", nil);
        return;
    }

    [_scannedPeripherals removeAllObjects];
    [_centralManager scanForPeripheralsWithServices:nil options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
    resolve(nil);
}

RCT_EXPORT_METHOD(stopScan:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    [_centralManager stopScan];
    resolve(nil);
}

RCT_EXPORT_METHOD(connect:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    CBPeripheral *peripheral = _scannedPeripherals[identifier];
    if (!peripheral) {
        // Try to retrieve known peripheral
        NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:identifier];
        if (uuid) {
            NSArray *known = [_centralManager retrievePeripheralsWithIdentifiers:@[uuid]];
            if (known.count > 0) {
                peripheral = known.firstObject;
            }
        }
    }

    if (!peripheral) {
        reject(@"DEVICE_NOT_FOUND", @"Device not found", nil);
        return;
    }

    // Stop scan
    [_centralManager stopScan];
    
    // Connect
    _connectedPeripheral = peripheral;
    _connectedPeripheral.delegate = self;
    _connectResolve = resolve;
    _connectReject = reject;
    [_centralManager connectPeripheral:_connectedPeripheral options:nil];
}

RCT_EXPORT_METHOD(disconnect:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    if (_connectedPeripheral) {
        [_centralManager cancelPeripheralConnection:_connectedPeripheral];
        _connectedPeripheral = nil;
        _writeCharacteristic = nil;
    }
    resolve(nil);
}

RCT_EXPORT_METHOD(getPairedDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    // iOS doesn't expose pairing list directly. Return connected peripherals.
    NSArray *connected = [_centralManager retrieveConnectedPeripheralsWithServices:@[]]; 
    // Need service UUIDs for retrieveConnectedPeripheralsWithServices, passing empty array returns none?
    // Actually, passing nothing returns nothing. We need known service UUIDs.
    // Let's return empty for now as iOS handles "paired" differently.
    // Or scan specific services.
    resolve(@[]);
}

RCT_EXPORT_METHOD(printRawData:(NSString *)base64String resolve:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
    if (!_connectedPeripheral || !_writeCharacteristic) {
        reject(@"NOT_CONNECTED", @"Not connected to a printer", nil);
        return;
    }

    NSData *data = [[NSData alloc] initWithBase64EncodedString:base64String options:0];
    if (!data) {
        reject(@"INVALID_DATA", @"Invalid base64 string", nil);
        return;
    }

    // Write with response? Thermal printers often use WriteWithoutResponse for speed, but WriteWithResponse is safer.
    // Check properties
    CBCharacteristicWriteType type = CBCharacteristicWriteWithResponse;
    if (_writeCharacteristic.properties & CBCharacteristicPropertyWriteWithoutResponse) {
        type = CBCharacteristicWriteWithoutResponse;
    } else if (!(_writeCharacteristic.properties & CBCharacteristicPropertyWrite)) {
        reject(@"WRITE_ERROR", @"Check char properties failed", nil);
        return;
    }

    // Chunking might be needed for large data (MTU size)
    // Simple implementation:
    NSUInteger mtu = [_connectedPeripheral maximumWriteValueLengthForType:type];
    if (mtu == 0) mtu = 20;

    NSUInteger length = data.length;
    NSUInteger offset = 0;

    while (offset < length) {
        NSUInteger chunkLen = MIN(length - offset, mtu);
        NSData *chunk = [data subdataWithRange:NSMakeRange(offset, chunkLen)];
        [_connectedPeripheral writeValue:chunk forCharacteristic:_writeCharacteristic type:type];
        offset += chunkLen;
        // Basic throttle/delay could be added here if needed
        [NSThread sleepForTimeInterval:0.005]; 
    }
    
    resolve(nil);
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central
{
    switch (central.state) {
        case CBManagerStatePoweredOn:
            // Ready
            break;
        default:
            // Handle error states
            break;
    }
}

- (void)centralManager:(CBCentralManager *)central didDiscoverPeripheral:(CBPeripheral *)peripheral advertisementData:(NSDictionary<NSString *,id> *)advertisementData RSSI:(NSNumber *)RSSI
{
    if (!peripheral.name) return;
    
    NSString *identifier = peripheral.identifier.UUIDString;
    _scannedPeripherals[identifier] = peripheral;
    
    if (_hasListeners) {
        [self sendEventWithName:@"DeviceFound" body:@{
            @"name": peripheral.name ?: @"Unknown",
            @"address": identifier, // iOS uses UUID as address
            @"id": identifier
        }];
    }
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral
{
    _connectedPeripheral = peripheral;
    peripheral.delegate = self;
    
    if (_hasListeners) {
        [self sendEventWithName:@"DeviceConnected" body:@{@"name": peripheral.name ?: @"Unknown", @"address": peripheral.identifier.UUIDString}];
    }
    
    // Discover services
    [peripheral discoverServices:nil];
    
    if (_connectResolve) {
        _connectResolve(@"Connected");
        _connectResolve = nil;
        _connectReject = nil;
    }
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error
{
    _connectedPeripheral = nil;
    _writeCharacteristic = nil;
    if (_hasListeners) {
        [self sendEventWithName:@"DeviceDisconnected" body:@{@"address": peripheral.identifier.UUIDString}];
    }
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error
{
    if (_hasListeners) {
        [self sendEventWithName:@"Error" body:@{@"message": error.localizedDescription ?: @"Connection failed"}];
    }
    
    if (_connectReject) {
        _connectReject(@"CONNECT_FAILED", error.localizedDescription, error);
        _connectResolve = nil;
        _connectReject = nil;
    }
}

#pragma mark - CBPeripheralDelegate

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error
{
    if (error) return;
    for (CBService *service in peripheral.services) {
        // Discover characteristics for all services
        [peripheral discoverCharacteristics:nil forService:service];
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error
{
    if (error) return;
    for (CBCharacteristic *characteristic in service.characteristics) {
        // Look for write characteristic
        if ((characteristic.properties & CBCharacteristicPropertyWrite) || (characteristic.properties & CBCharacteristicPropertyWriteWithoutResponse)) {
            _writeCharacteristic = characteristic;
            // Optionally break? Keep last found or look for specific one?
            // Usually first writable characteristic works for generic printers
        }
    }
}

@end
