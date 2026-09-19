import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('startListening is idempotent and does not replace an active subscription', () {
    final source = File('lib/core/offline/sync/sync_engine.dart').readAsStringSync();

    expect(
      source,
      contains('if (_connectivitySubscription != null) return;'),
      reason: 'startListening must return before registering a second connectivity listener',
    );

    final assignments = RegExp(r'_connectivitySubscription\s*=\s*_connectivity\.onConnectivityChanged\.listen')
        .allMatches(source)
        .length;
    expect(assignments, 1);
  });
}
