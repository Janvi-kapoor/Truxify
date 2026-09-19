import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/api_client.dart';
import 'package:truxify_driver/services/trip_service.dart';

class RecordingApiClient extends ApiClient {
  RecordingApiClient(this.response) : super(baseUrl: 'https://example.test');

  final dynamic response;
  String? lastGetPath;

  @override
  Future<dynamic> get(
    String path, {
    Map<String, String>? headers,
  }) async {
    lastGetPath = path;
    return response;
  }
}

void main() {
  test('fetchTripItems uses the mounted driver trip-items endpoint', () async {
    final client = RecordingApiClient([
      {'id': 'item-1', 'status': 'pending'},
    ]);
    final service = TripService(
      apiClient: client,
      apiBaseUrl: 'https://example.test',
    );

    final items = await service.fetchTripItems('TRIP/123');

    expect(
      client.lastGetPath,
      '/api/driver/trips/TRIP%2F123/items',
    );
    expect(items, hasLength(1));
    expect(items.single['id'], 'item-1');

    service.dispose();
  });
}
