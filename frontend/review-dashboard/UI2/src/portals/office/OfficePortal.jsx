import React from 'react';
import MobileDashboard from '../common/MobileDashboard';

const OfficePortal = ({ 
    onUploadNew, 
    onOpenLorrySlip, 
    onOpenFuelSlip, 
    onOpenFuelRateSettings,
    onOpenRegisters 
}) => {
    return (
        <MobileDashboard 
            onUploadNew={onUploadNew}
            onOpenLorrySlip={onOpenLorrySlip}
            onOpenFuelSlip={onOpenFuelSlip}
            onOpenFuelRateSettings={onOpenFuelRateSettings}
            onOpenRegisters={onOpenRegisters}
        />
    );
};

export default OfficePortal;
