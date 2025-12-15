import tobii_research as tr
import time
import json
from datetime import datetime
import os

found_eyetrackers = tr.find_all_eyetrackers()

my_eyetracker = found_eyetrackers[0]
print("Address: " + my_eyetracker.address)
print("Model: " + my_eyetracker.model)
print("Name (It's OK if this is empty): " + my_eyetracker.device_name)
print("Serial number: " + my_eyetracker.serial_number)

def gaze_data_callback(gaze_data):
    # Write gaze points of left and right eye with timestamp in JSON format to file
    log_entry = {
        "timestamp": time.time(),
        "left_eye": gaze_data['left_gaze_point_on_display_area'],
        "right_eye": gaze_data['right_gaze_point_on_display_area']
    }
    log_file.write(json.dumps(log_entry) + '\n')
    log_file.flush()
    
# Create logs directory if it doesn't exist
os.makedirs('./logs', exist_ok=True)

# Create filename with timestamp
filename = datetime.now().strftime('%Y%m%d-%H%M%S.json')
log_path = os.path.join('./logs', filename)

my_eyetracker.subscribe_to(tr.EYETRACKER_GAZE_DATA, gaze_data_callback, as_dictionary=True)

print(f"Tracking started. Logging to {log_path}")
print("Press Ctrl+C to stop...")

try:
    with open(log_path, 'w') as log_file:
        while True:
            time.sleep(0.1)
except KeyboardInterrupt:
    print("\nStopping...")
finally:
    my_eyetracker.unsubscribe_from(tr.EYETRACKER_GAZE_DATA, gaze_data_callback)
    print("Unsubscribed from eye tracker.")