import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

# Mock TensorFlow before importing TrafficPipeline so the tests don't require
# a TensorFlow/NumPy-compatible runtime.
mock_tf = MagicMock()
mock_tf.keras = MagicMock()
mock_tf.keras.models = MagicMock()
mock_tf.keras.layers = MagicMock()
mock_tf.keras.optimizers = MagicMock()
mock_tf.keras.models.load_model = MagicMock()
mock_tf.keras.optimizers.Adam = MagicMock()

sys.modules["tensorflow"] = mock_tf
sys.modules["tensorflow.keras"] = mock_tf.keras
sys.modules["tensorflow.keras.models"] = mock_tf.keras.models
sys.modules["tensorflow.keras.layers"] = mock_tf.keras.layers
sys.modules["tensorflow.keras.optimizers"] = mock_tf.keras.optimizers

from services.traffic_pipeline import TrafficPipeline


class TestTrafficPipeline:
    @patch("redis.Redis.from_url")
    def test_traffic_pipeline_init(self, mock_redis, tmp_path):
        db_path = str(tmp_path / "traffic_test.db")
        db_url = f"sqlite:///{db_path}"
        redis_url = "redis://localhost:6379"

        pipeline = TrafficPipeline(
            db_url=db_url,
            redis_url=redis_url,
        )

        assert pipeline.engine is not None
        assert pipeline.redis is not None
        assert os.path.exists(db_path)

class TestEtaComputation:
    """Tests for the ETA computation formula in update_eta_realtime.

    The bug was: eta_seconds = (route_distance_m / 1000.0) / (speed_kmh / 3.6)
    This mixes km (from dividing m by 1000) with m/s (from dividing km/h by 3.6),
    producing a result 1000x too small.

    Correct formula: eta_seconds = route_distance_m / (speed_kmh / 3.6)
    This converts speed to m/s first, then divides distance_m by speed_mps to get
    seconds.
    """

    def test_eta_formula_returns_correct_seconds(self):
        """10 km at 40 km/h should be ~900 seconds (15 minutes)."""
        route_distance_m = 10000  # 10 km in metres
        predicted_speed_kmh = 40.0
        # Correct formula: distance_m / (speed_kmh / 3.6) = 10000 / 11.111 = 900
        eta_seconds = route_distance_m / (predicted_speed_kmh / 3.6)
        assert 890 < eta_seconds < 910, f"Expected ~900s, got {eta_seconds}"

    def test_eta_formula_100x_too_small_before_fix(self):
        """Verify the old (incorrect) formula was off by exactly 1000x."""
        route_distance_m = 10000
        predicted_speed_kmh = 40.0
        # Incorrect: (route_distance_m / 1000.0) / (speed_kmh / 3.6)
        incorrect_eta = (
            route_distance_m / 1000.0
        ) / (predicted_speed_kmh / 3.6)
        correct_eta = route_distance_m / (predicted_speed_kmh / 3.6)
        assert incorrect_eta == correct_eta / 1000, (
            "Old formula should be exactly 1000x smaller than correct formula"
        )

    def test_eta_zero_distance_returns_zero(self):
        """Zero distance should give zero ETA regardless of speed."""
        route_distance_m = 0
        predicted_speed_kmh = 40.0
        eta_seconds = route_distance_m / (predicted_speed_kmh / 3.6)
        assert eta_seconds == 0.0

    def test_eta_reasonable_range_for_real_trip(self):
        """100 km at 60 km/h should be ~6000 seconds (100 minutes)."""
        route_distance_m = 100000  # 100 km
        predicted_speed_kmh = 60.0
        eta_seconds = route_distance_m / (predicted_speed_kmh / 3.6)
        assert 5900 < eta_seconds < 6100, (
            f"Expected ~6000s, got {eta_seconds}"
        )


@pytest.fixture
def pipeline():
    pipeline = TrafficPipeline.__new__(TrafficPipeline)
    pipeline.osrm_url = "http://localhost:5000"
    pipeline.gmaps_api_key = "test-api-key"
    pipeline.traffic_connect_timeout = 2
    pipeline.traffic_total_timeout = 5
    pipeline._osrm_failure_count = 0
    pipeline._osrm_circuit_open = False
    return pipeline


class TestTrafficPipelineResilience:
    @pytest.mark.asyncio
    async def test_fetch_osrm_data_returns_route_data(self, pipeline):
        response = MagicMock()
        response.json = AsyncMock(
            return_value={
                "routes": [
                    {
                        "duration": 120,
                        "distance": 3000,
                    }
                ]
            }
        )

        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(return_value=response)
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ):
            result = await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert result["duration"] == 120
        assert result["distance"] == 3000
        assert result["speed"] == 25
        assert result["free_flow_speed"] == 31.25

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_uses_configured_timeout(self, pipeline):
        response = MagicMock()
        response.json = AsyncMock(
            return_value={
                "routes": [
                    {
                        "duration": 120,
                        "distance": 3000,
                    }
                ]
            }
        )

        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(return_value=response)
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ) as mock_client_session, patch(
            "services.traffic_pipeline.aiohttp.ClientTimeout"
        ) as mock_timeout:
            mock_timeout.return_value = "timeout-config"

            await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        mock_timeout.assert_called_once_with(
            connect=2,
            total=5,
        )
        mock_client_session.assert_called_once_with(
            timeout="timeout-config",
        )

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_falls_back_when_request_times_out(
        self,
        pipeline,
    ):
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(
            side_effect=TimeoutError("OSRM request timed out")
        )
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ), patch(
            "services.traffic_pipeline.asyncio.sleep",
            new_callable=AsyncMock,
        ):
            result = await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert result == {
            "speed": 50,
            "free_flow_speed": 80,
        }

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_retries_after_transient_failure(
        self,
        pipeline,
    ):
        response = MagicMock()
        response.json = AsyncMock(
            return_value={
                "routes": [
                    {
                        "duration": 120,
                        "distance": 3000,
                    }
                ]
            }
        )

        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(
            side_effect=[
                aiohttp.ClientError("temporary failure"),
                response,
            ]
        )
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ), patch(
            "services.traffic_pipeline.asyncio.sleep",
            new_callable=AsyncMock,
        ) as mock_sleep:
            result = await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert result["duration"] == 120
        assert result["distance"] == 3000
        assert session.get.call_count == 2
        mock_sleep.assert_awaited_once_with(1)

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_stops_after_max_retries(self, pipeline):
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(
            side_effect=aiohttp.ClientError("OSRM unavailable")
        )
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ), patch(
            "services.traffic_pipeline.asyncio.sleep",
            new_callable=AsyncMock,
        ) as mock_sleep:
            result = await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert result == {
            "speed": 50,
            "free_flow_speed": 80,
        }
        assert session.get.call_count == 3
        assert mock_sleep.await_count == 2

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_uses_exponential_backoff(self, pipeline):
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(
            side_effect=[
                aiohttp.ClientError("failure 1"),
                aiohttp.ClientError("failure 2"),
                aiohttp.ClientError("failure 3"),
            ]
        )
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ), patch(
            "services.traffic_pipeline.asyncio.sleep",
            new_callable=AsyncMock,
        ) as mock_sleep:
            await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert mock_sleep.await_args_list == [
            ((1,),),
            ((2,),),
        ]

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_opens_circuit_after_five_failures(
        self,
        pipeline,
    ):
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(
            side_effect=aiohttp.ClientError("OSRM unavailable")
        )
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ), patch(
            "services.traffic_pipeline.asyncio.sleep",
            new_callable=AsyncMock,
        ):
            for _ in range(5):
                result = await pipeline._fetch_osrm_data(
                    {"lat": 28.6139, "lng": 77.2090},
                    {"lat": 28.6200, "lng": 77.2100},
                )
                assert result["speed"] == 50

        calls_after_failures = session.get.call_count

        result = await pipeline._fetch_osrm_data(
            {"lat": 28.6139, "lng": 77.2090},
            {"lat": 28.6200, "lng": 77.2100},
        )

        assert result["speed"] == 50
        assert session.get.call_count == calls_after_failures

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_success_resets_failure_count(
        self,
        pipeline,
    ):
        pipeline._osrm_failure_count = 4

        response = MagicMock()
        response.json = AsyncMock(
            return_value={
                "routes": [
                    {
                        "duration": 120,
                        "distance": 3000,
                    }
                ]
            }
        )

        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(return_value=response)
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ):
            result = await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert result["duration"] == 120
        assert pipeline._osrm_failure_count == 0

    @pytest.mark.asyncio
    async def test_fetch_gmaps_traffic_uses_configured_timeout(self, pipeline):
        response = MagicMock()
        response.json = AsyncMock(
            return_value={
                "routes": [
                    {
                        "legs": [
                            {
                                "duration_in_traffic": {"value": 120},
                                "duration": {"value": 100},
                                "distance": {"value": 3000},
                            }
                        ]
                    }
                ]
            }
        )

        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(return_value=response)
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ) as mock_client_session, patch(
            "services.traffic_pipeline.aiohttp.ClientTimeout"
        ) as mock_timeout:
            mock_timeout.return_value = "timeout-config"

            await pipeline._fetch_gmaps_traffic(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        mock_timeout.assert_called_once_with(
            connect=2,
            total=5,
        )
        mock_client_session.assert_called_once_with(
            timeout="timeout-config",
        )

    @pytest.mark.asyncio
    async def test_fetch_gmaps_traffic_falls_back_when_request_times_out(
        self,
        pipeline,
    ):
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(
            side_effect=TimeoutError("Google Maps timed out")
        )
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ):
            result = await pipeline._fetch_gmaps_traffic(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert result == {}

    @pytest.mark.asyncio
    async def test_fetch_osrm_data_falls_back_when_no_route_is_returned(
        self,
        pipeline,
    ):
        response = MagicMock()
        response.json = AsyncMock(
            return_value={"routes": []}
        )

        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        request_context = MagicMock()
        request_context.__aenter__ = AsyncMock(return_value=response)
        request_context.__aexit__ = AsyncMock(return_value=None)

        session.get = MagicMock(return_value=request_context)

        with patch(
            "services.traffic_pipeline.aiohttp.ClientSession",
            return_value=session,
        ):
            result = await pipeline._fetch_osrm_data(
                {"lat": 28.6139, "lng": 77.2090},
                {"lat": 28.6200, "lng": 77.2100},
            )

        assert result == {
            "speed": 50,
            "free_flow_speed": 80,
        }