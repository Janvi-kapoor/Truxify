import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/secure_storage.dart';
import 'package:truxify_driver/services/trip_cache.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  final trips = <Map<String, dynamic>>[
    {'trip_display_id': 'trip-1', 'status': 'completed'},
    {'trip_display_id': 'trip-2', 'status': 'in_progress'},
  ];
  final stopsByTripId = <String, List<Map<String, dynamic>>>{
    'trip-1': [
      {'stop_id': 'stop-1'},
    ],
  };
  final routePointsByTripId = <String, List<Map<String, dynamic>>>{
    'trip-1': [
      {'lat': 19.076, 'lng': 72.877},
    ],
  };
  final itemsByTripId = <String, List<Map<String, dynamic>>>{
    'trip-1': [
      {'item_id': 'item-1'},
    ],
  };

  group('TripCache.save/load', () {
    test('save writes JSON to secure storage and load returns it unchanged',
        () async {
      await TripCache.save(
        trips: trips,
        stopsByTripId: stopsByTripId,
        routePointsByTripId: routePointsByTripId,
        itemsByTripId: itemsByTripId,
      );

      expect(
        await SecureStorage.read('truxify_driver_cached_trips'),
        jsonEncode(trips),
      );
      expect(
        await SecureStorage.read('truxify_driver_cached_trip_stops'),
        jsonEncode(stopsByTripId),
      );
      expect(
        await SecureStorage.read('truxify_driver_cached_route_points'),
        jsonEncode(routePointsByTripId),
      );
      expect(
        await SecureStorage.read('truxify_driver_cached_trip_items'),
        jsonEncode(itemsByTripId),
      );
      expect(
        await SecureStorage.read('truxify_driver_cached_trips_saved_at'),
        isNotNull,
      );

      final snapshot = await TripCache.load();
      expect(snapshot, isNotNull);
      expect(snapshot!.trips, trips);
      expect(snapshot.stopsByTripId, stopsByTripId);
      expect(snapshot.routePointsByTripId, routePointsByTripId);
      expect(snapshot.itemsByTripId, itemsByTripId);
      expect(snapshot.savedAt, isNotNull);
    });

    test('load returns null when nothing is cached', () async {
      final snapshot = await TripCache.load();
      expect(snapshot, isNull);
    });

    test('load handles corrupt trips JSON gracefully', () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{
        'truxify_driver_cached_trips': 'not valid json',
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNull);
    });

    test('load handles non-list trips JSON gracefully', () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{
        'truxify_driver_cached_trips': '{"not": "a list"}',
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNull);
    });

    test('load handles corrupt section JSON gracefully', () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{
        'truxify_driver_cached_trips': jsonEncode(trips),
        'truxify_driver_cached_trip_stops': 'not valid json',
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNotNull);
      expect(snapshot!.trips, trips);
      expect(snapshot.stopsByTripId, isEmpty);
    });

    test('load clears expired cache', () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{
        'truxify_driver_cached_trips': jsonEncode(trips),
        'truxify_driver_cached_trips_saved_at':
            DateTime.now().subtract(const Duration(hours: 25)).toIso8601String(),
      });

      final snapshot = await TripCache.load();
      expect(snapshot, isNull);

      expect(
        await SecureStorage.read('truxify_driver_cached_trips'),
        isNull,
      );
    });
  });
}
