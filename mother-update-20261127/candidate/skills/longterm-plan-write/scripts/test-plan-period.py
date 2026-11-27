import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

entry=importlib.util.spec_from_file_location('period_check',Path(__file__).with_name('plan-spec-check.py'))
checker=importlib.util.module_from_spec(entry);entry.loader.exec_module(checker)

class PeriodTests(unittest.TestCase):
    def setUp(self):
        self.spec={'version':2,'name':'Example','ltcMgmtNo':'L0000000000','writeDate':'2026-11-26','adptFr':'2026-12-06','adptTo':'2027-12-05','contractEnd':'2030-12-05','newContract':False,'periodBasis':{'type':'renewal','contractStart':'2026-12-06','contractEnd':'2030-12-05','recognitionStart':'2026-12-06','recognitionEnd':'2030-12-05'}}
    def problems(self,sp=None):
        return [e for e in checker.check(sp or self.spec,'register') if e.startswith('period:')]
    def test_renewal_keeps_earlier_write_date(self):self.assertEqual([],self.problems())
    def test_renewal_cannot_start_on_write_date(self):
        self.spec['adptFr']='2026-11-26';self.assertTrue(self.problems())
    def test_renewal_must_start_on_recognition_date(self):
        self.spec['adptFr']='2026-12-07';self.assertTrue(self.problems())
    def test_continuation_is_day_after_previous_end(self):
        self.spec['periodBasis'].update(type='continuation',previousPlanNo='P1',previousEnd='2026-12-05')
        self.assertEqual([],self.problems());self.spec['periodBasis']['previousEnd']='2026-12-04';self.assertTrue(self.problems())
    def test_continuation_requires_previous_identity(self):
        self.spec['periodBasis'].update(type='continuation',previousEnd='2026-12-05');self.assertTrue(self.problems())
    def test_initial_uses_actual_contract_start(self):
        self.spec['newContract']=True;self.spec['periodBasis']['type']='initial';self.assertEqual([],self.problems())
    def test_type_and_initial_contract_flag_must_match(self):
        self.spec['newContract']=True;self.assertTrue(self.problems())
    def test_contract_boundary(self):
        self.spec['periodBasis']['contractEnd']='2027-01-01';self.spec['contractEnd']='2027-01-01';self.assertTrue(self.problems())
    def test_recognition_boundary(self):
        self.spec['periodBasis']['recognitionEnd']='2027-01-01';self.assertTrue(self.problems())
    def test_more_than_365_days_rejected(self):
        self.spec['adptTo']='2027-12-06';self.assertTrue(self.problems())
    def test_legacy_spec_does_not_gain_exemption(self):
        del self.spec['periodBasis'];self.assertTrue(self.problems())
    def test_existing_plan_edit_preserves_period(self):
        self.spec['planMode']='update';self.assertEqual([],self.problems())

if __name__=='__main__':unittest.main()
