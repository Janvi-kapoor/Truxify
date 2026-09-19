import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'secure_storage.dart';

/// Caches the most recently loaded trip list locally so drivers can still
/// see delivery details, stops, and route points when the network is
/// unavailable mid-trip.
///
/// Trip data contains PII (customer addresses, drop locations) and financial
/// data (payouts), so it is persisted via OS-backed secure storage rather
/// than plaintext SharedPreferences (issue #14936).
class TripCache {
  static const String _tripsKey = 'truxify_driver_cached_trips';
  static const String _stopsKey = 'truxify_driver_cached_trip_stops';
  static const String _routePointsKey = 'truxify_driver_cached_route_points';
  static const String _itemsKey = 'truxify_driver_cached_trip_items';
  static const String _savedAtKey = 'truxify_driver_cached_trips_saved_at';
  static const Duration _ttl = Duration(hours: 24);

  static Map<String, List<Map<String, dynamic>>> _decodeTripSections(
    String? raw,
  ) {
    if (raw == null) {
      return <String, List<Map<String, dynamic>>>{};
    }

    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        return <String, List<Map<String, dynamic>>>{};
      }

      final sections = <String, List<Map<String, dynamic>>>{};
      decoded.forEach((key, value) {
        if (value is! List) return;
        sections[key.toString()] = value
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList(growable: false);
      });
      return sections;
    } catch (e) {
      debugPrint('TripCache decode error: $e');
      return <String, List<Map<String, dynamic>>>{};
    }
  }

  static Future<void> _clear() async {
    await Future.wait([
      SecureStorage.delete(_tripsKey),
      SecureStorage.delete(_stopsKey),
      SecureStorage.delete(_routePointsKey),
      SecureStorage.delete(_itemsKey),
      SecureStorage.delete(_savedAtKey),
    ]);
  }

  static Future<void> save({
    required List<Map<String, dynamic>> trips,
    required Map<String, List<Map<String, dynamic>>> stopsByTripId,
    required Map<String, List<Map<String, dynamic>>> routePointsByTripId,
    required Map<String, List<Map<String, dynamic>>> itemsByTripId,
  }) async {
    await SecureStorage.save(_tripsKey, jsonEncode(trips));
    await SecureStorage.save(_stopsKey, jsonEncode(stopsByTripId));
    await SecureStorage.save(_routePointsKey, jsonEncode(routePointsByTripId));
    await SecureStorage.save(_itemsKey, jsonEncode(itemsByTripId));
    await SecureStorage.save(_savedAtKey, DateTime.now().toIso8601String());
  }

  /// Returns cached trip data, or null if nothing has been cached yet.
  static Future<TripCacheSnapshot?> load() async {
    final tripsRaw = await SecureStorage.read(_tripsKey);
    if (tripsRaw == null) {
      return null;
    }

    try {
      final trips = List<Map<String, dynamic>>.from(
        (jsonDecode(tripsRaw) as List)
            .map((e) => Map<String, dynamic>.from(e as Map)),
      );

      final stopsByTripId = _decodeTripSections(
          await SecureStorage.read(_stopsKey));
      final routePointsByTripId = _decodeTripSections(
          await SecureStorage.read(_routePointsKey));
      final itemsByTripId = _decodeTripSections(
          await SecureStorage.read(_itemsKey));

      final savedAtRaw = await SecureStorage.read(_savedAtKey);
      final savedAt = savedAtRaw != null ? DateTime.tryParse(savedAtRaw) : null;

      if (savedAt != null && DateTime.now().difference(savedAt) > _ttl) {
        await _clear();
        return null;
      }

      return TripCacheSnapshot(
        trips: trips,
        stopsByTripId: stopsByTripId,
        routePointsByTripId: routePointsByTripId,
        itemsByTripId: itemsByTripId,
        savedAt: savedAt,
      );
    } catch (e) {
      debugPrint('TripCache load error: $e');
      return null;
    }
  }
}

class TripCacheSnapshot {
  const TripCacheSnapshot({
    required this.trips,
    required this.stopsByTripId,
    required this.routePointsByTripId,
    required this.itemsByTripId,
    required this.savedAt,
  });

  final List<Map<String, dynamic>> trips;
  final Map<String, List<Map<String, dynamic>>> stopsByTripId;
  final Map<String, List<Map<String, dynamic>>> routePointsByTripId;
  final Map<String, List<Map<String, dynamic>>> itemsByTripId;
  final DateTime? savedAt;
}
