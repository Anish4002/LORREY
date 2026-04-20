import React from 'react';
import MobileDashboard from '../common/MobileDashboard';

const SitePortal = ({ 
    onUploadNew, 
    onOpenLorrySlip, 
    onOpenFuelSlip, 
    onOpenRegisters 
}) => {
    return (
        <MobileDashboard 
            onUploadNew={onUploadNew}
            onOpenLorrySlip={onOpenLorrySlip}
            onOpenFuelSlip={onOpenFuelSlip}
            onOpenRegisters={onOpenRegisters}
            // onOpenFuelRateSettings is null for Site Admin
        />
    );
};

export default SitePortal;
