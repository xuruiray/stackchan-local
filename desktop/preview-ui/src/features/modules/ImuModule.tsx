import { ModulePage } from "../../components/ModulePage";
import { dash, numberText } from "../../model/format";
import { Imu3DView } from "./Imu3DView";
import { deviceUpdated, ModuleProps, mot, record } from "./module-utils";

export function ImuModule({ snapshot }: ModuleProps): JSX.Element {
  const imu = record(mot(snapshot).imu);
  const accelMagnitude =
    Number.isFinite(imu.x) && Number.isFinite(imu.y) && Number.isFinite(imu.z)
      ? Math.sqrt(imu.x ** 2 + imu.y ** 2 + imu.z ** 2)
      : undefined;
  const gyroMagnitude =
    Number.isFinite(imu.gyroX) && Number.isFinite(imu.gyroY) && Number.isFinite(imu.gyroZ)
      ? Math.sqrt(imu.gyroX ** 2 + imu.gyroY ** 2 + imu.gyroZ ** 2)
      : undefined;
  return (
    <ModulePage
      title="IMU"
      chip="BMI270"
      value={imu}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Motion", value: dash(imu.motion) },
        { label: "Accel X", value: numberText(imu.x, 3) },
        { label: "Accel Y", value: numberText(imu.y, 3) },
        { label: "Accel Z", value: numberText(imu.z, 3) },
        { label: "Gyro X", value: numberText(imu.gyroX, 2, " dps") },
        { label: "Gyro Y", value: numberText(imu.gyroY, 2, " dps") },
        { label: "Gyro Z", value: numberText(imu.gyroZ, 2, " dps") },
        { label: "Accel magnitude", value: numberText(accelMagnitude, 3) },
        { label: "Gyro magnitude", value: numberText(gyroMagnitude, 2, " dps") }
      ]}
    >
      <Imu3DView imu={imu} />
    </ModulePage>
  );
}
