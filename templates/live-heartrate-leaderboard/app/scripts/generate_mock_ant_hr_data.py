from moose_lib import Task, Workflow, TaskConfig, WorkflowConfig, Logger, TaskContext
import requests
import json
import random
import time
import math
from pathlib import Path
from app.datamodels.RawAntHRPacket import RawAntHRPacket

def load_mock_device_ids() -> list[int]:
    """
    Loads device IDs from mock-user-db.json, excluding devices with live_bt_device=True
    Returns a list of integer device IDs
    """
    json_path = Path(__file__).parents[2] / 'mock-user-db.json'
    with open(json_path) as f:
        user_db = json.load(f)
    
    device_ids = [int(device_id) for device_id, data in user_db.items() 
            if not data.get('live_bt_device') == "True"]
    
    print(f"Using mock device IDs: {device_ids}")
    return device_ids

def generate_mock_ant_hr_data(ctx: TaskContext[RawAntHRPacket]) -> None:
    """
    This script mocks N users who are wearing an ANT+ heart rate monitor.
    It sends data to Moose four times per second indefinitely
    This simulates a realistic ANT+ sensor with byte rollover
    For reference view the pdf in this repo under /docs/ANT-HRM-Packet-Format.pdf
    """
    logger = Logger("generator")
    logger.info("Starting mock ANT+ HR data generator")
    # Define the API endpoint URL
    url = "http://localhost:4000/ingest/raw_ant_hr_packet"
    headers = {'Content-Type': 'application/json'}

    # Update for the number of devices
    device_ids = load_mock_device_ids()
    
    start_time = time.time()

    # Initialize device-specific data
    device_data = {
        device_id: {
            'hr_history': [],
            'previous_beat_time': 0,
            'last_beat_time': 0,
            'beat_count': 0,
            'time_rollover': 0,
            'packet_number': 0,
            'rhr': random.randint(55, 85),
            'hr_max': random.randint(200, 220),
            'hr_event': False,
            'phase': random.random(),
            'target_hr': 0,  # Initialize target heart rate
        } for device_id in device_ids
    }
    
    # Set initial target heart rate for each device
    for device_id in device_ids:
        device_data[device_id]['target_hr'] = device_data[device_id]['rhr']
        # Add an initial HR value to the history
        device_data[device_id]['hr_history'].append(device_data[device_id]['rhr'])

    # Main loop - runs indefinitely
    for device_id in device_ids:
        # time_elapsed is still useful for the interval calculation
        time_elapsed = time.time() - start_time 
        
        # Determine the last recorded heart rate for smoothing
        last_hr = device_data[device_id]['hr_history'][-1] if device_data[device_id]['hr_history'] else None
        
        # Update target HR less frequently (e.g., every few packets or based on HR event)
        # For simplicity, let's update it when a beat event occurs or at the start
        if device_data[device_id]['hr_event'] or device_data[device_id]['packet_number'] == 0:
            device_data[device_id]['target_hr'] = generate_realistic_heart_rate(
                time_elapsed,
                base_hr=device_data[device_id]['rhr'],
                max_hr=device_data[device_id]['hr_max'], 
                last_hr=last_hr, # Pass last HR for smoothing
                phase=device_data[device_id]['phase'] # Phase can still be used for variation between devices
            )
            device_data[device_id]['hr_event'] = False
        
        ant_packet = generate_ant_hrm_packet(device_id, device_data[device_id])
        json_data = json.dumps(ant_packet)
        
        try:
            logger.info(f"Sending JSON: {json_data}")
            response = requests.post(url, data=json_data, headers=headers)
            if response.status_code == 200:
                logger.info(f"Successfully sent packet: {ant_packet}")
            else:
                logger.error(f"Failed to send packet: {response.status_code}, {response.text}")
        except requests.exceptions.RequestException as e:
            logger.error(f"An error occurred: {e}")
            # Pause briefly if there's a connection error
            time.sleep(1)  # Wait 1 second before retry

        time.sleep(0.25)
        
    return {
        "task": "gen_stuff",
        "data": {
            "number_of_devices": len(device_ids)
        }
    }

def generate_ant_hrm_packet(device_id: int, device_data: dict):
    """
    Generates a synthetic ANT+ HRM packet based on a target heart rate.
    Returns the packet, a boolean indicating if a heart rate event occurred,
    and the updated last_beat_time and beat_count.
    """
    transmission_type = 1
    device_type = 120  # ANT+ device type for HRM
    page_number = 0x04  # Page 4 per ANT+ HRM specification (https://err.no/tmp/ANT_Device_Profile_Heart_Rate_Monitor.pdf)

    # Absolute time scale in seconds
    current_time = device_data['packet_number'] * 0.25 * 1024  # Convert to 1/1024 second resolution
    next_beat_time = (60 * 1024 / device_data['target_hr']) + device_data['last_beat_time'] + (device_data['time_rollover'] * 65536)


    if device_data['last_beat_time'] > 65536:
        device_data['time_rollover'] += 1
        device_data['last_beat_time'] = device_data['last_beat_time'] % 65536

    # Boolean indicating if a heart beat event occurred
    heart_rate_event = current_time > next_beat_time

    if heart_rate_event:
        device_data['previous_beat_time'] = device_data['last_beat_time'] % 65536
        device_data['last_beat_time'] = next_beat_time % 65536
        device_data['beat_count'] = (device_data['beat_count'] + 1) % 255 
        device_data['hr_event'] = True
        device_data['hr_history'].append(device_data['target_hr'])


    # Assemble the 8-byte data payload
    data_payload = [
        page_number,  # Byte 0: Page Number
        0xFF,  # Byte 1: Manufacturer Specific
        int(device_data['previous_beat_time']) & 0xFF,  # Byte 2: Previous Heart Beat Event Time LSB
        (int(device_data['previous_beat_time']) >> 8) & 0xFF,  # Byte 3: Previous Heart Beat Event Time MSB
        int(device_data['last_beat_time']) & 0xFF,  # Byte 4: Heart Beat Event Time LSB
        (int(device_data['last_beat_time']) >> 8) & 0xFF,  # Byte 5: Heart Beat Event Time MSB
        device_data['beat_count'],  # Byte 6: Heart Beat Count
        device_data['target_hr']  # Byte 7: Computed Heart Rate (use target HR if no history)
    ]

    # Construct the ANT+ packet as a dictionary
    ant_packet = {
        "device_id": device_id,
        "packet_count": device_data['packet_number'],
        "ant_hr_packet": data_payload
    }

    device_data['packet_number'] += 1
    return ant_packet


# Updated function to remove session duration dependency
def generate_realistic_heart_rate(time_elapsed, base_hr=60, max_hr=180, last_hr=None, phase=0.5):
    # HIIT workout parameters (remain the same)
    interval_duration = 60  # 60 seconds per interval
    high_intensity_duration = 30  # 30 seconds high intensity
    
    # Calculate current interval time (phase adjusted)
    # Use phase to offset the start time of the interval cycle for each device
    phased_time_elapsed = time_elapsed + (interval_duration * phase)
    current_interval = phased_time_elapsed % interval_duration
    
    # Define target heart rates
    high_hr = max_hr * 0.85  # 85% of max HR for high intensity
    low_hr = max_hr * 0.65   # 65% of max HR for recovery
    
    # Determine target heart rate based *only* on HIIT interval section
    # Removed warm-up/cool-down logic
    if current_interval < high_intensity_duration:
        # Ramp up during high intensity phase (simplified)
        target_hr = low_hr + (high_hr - low_hr) * (current_interval / high_intensity_duration)
    else:
        # Ramp down during recovery phase (simplified)
        target_hr = high_hr + (low_hr - high_hr) * ((current_interval - high_intensity_duration) / (interval_duration - high_intensity_duration))
    
    # Add minimal random variation
    variation = random.uniform(-1, 1)
    new_hr = target_hr + variation
    
    # Apply strong smoothing using last heart rate
    if last_hr is not None:
        # Adjust smoothing factor if needed, 0.85 retains more history
        new_hr = 0.85 * last_hr + 0.15 * new_hr 
    else:
        # If no history, start closer to base HR
        new_hr = base_hr + (new_hr - base_hr) * 0.1 
    
    # Ensure heart rate stays within bounds
    return int(max(base_hr * 0.9, min(round(new_hr), max_hr))) # Allow slightly below base_hr

ingest_task = Task[RawAntHRPacket, None](
    name="task",
    config=TaskConfig(run=generate_mock_ant_hr_data)
)
ingest_workflow = Workflow(
    name="workflow",
    config=WorkflowConfig(starting_task=ingest_task, schedule="@every 5s")
)


