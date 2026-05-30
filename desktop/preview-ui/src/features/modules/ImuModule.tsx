import { ModulePage } from "../../components/ModulePage";
import { dash, numberText } from "../../model/format";
import { Imu3DView } from "./Imu3DView";
import { bmi, deviceUpdated, ModuleProps } from "./module-utils";

export function ImuModule({ snapshot }: ModuleProps): JSX.Element {
  const bmi270 = bmi(snapshot);
  const attitude: Record<string, unknown> = bmi270.attitude && typeof bmi270.attitude === "object" ? bmi270.attitude : {};
  const accelMagnitude =
    Number.isFinite(bmi270.x) && Number.isFinite(bmi270.y) && Number.isFinite(bmi270.z)
      ? Math.sqrt(bmi270.x ** 2 + bmi270.y ** 2 + bmi270.z ** 2)
      : undefined;
  const gyroMagnitude =
    Number.isFinite(bmi270.gyroX) && Number.isFinite(bmi270.gyroY) && Number.isFinite(bmi270.gyroZ)
      ? Math.sqrt(bmi270.gyroX ** 2 + bmi270.gyroY ** 2 + bmi270.gyroZ ** 2)
      : undefined;
  return (
    <ModulePage
      title="IMU"
      chip="BMI270"
      value={bmi270}
      updated={deviceUpdated(snapshot)}
      metrics={[
        { label: "Motion", value: dash(bmi270.motion) },
        { label: "Accel X", value: numberText(bmi270.x, 3) },
        { label: "Accel Y", value: numberText(bmi270.y, 3) },
        { label: "Accel Z", value: numberText(bmi270.z, 3) },
        { label: "Gyro X", value: numberText(bmi270.gyroX, 2, " dps") },
        { label: "Gyro Y", value: numberText(bmi270.gyroY, 2, " dps") },
        { label: "Gyro Z", value: numberText(bmi270.gyroZ, 2, " dps") },
        { label: "Attitude", value: dash(attitude.quality) },
        { label: "Pitch", value: numberText(attitude.pitchDeg, 1, " deg") },
        { label: "Roll", value: numberText(attitude.rollDeg, 1, " deg") },
        { label: "Yaw", value: numberText(attitude.yawDeg, 1, " deg") },
        { label: "Accel magnitude", value: numberText(accelMagnitude, 3) },
        { label: "Gyro magnitude", value: numberText(gyroMagnitude, 2, " dps") }
      ]}
    >
      <Imu3DView imu={bmi270} />
    </ModulePage>
  );
}
